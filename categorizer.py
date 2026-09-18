"""
categorizer.py
Two-layer categorization:

  1. RULES  - fast, deterministic, user-editable keyword/regex rules
              (rules.json). Always tried first — if a rule matches, that
              category wins and the transaction is never sent to the ML
              layer, so your explicit rules always take priority.

  2. ML     - a TF-IDF + Logistic Regression text classifier trained on
              every transaction you've manually confirmed or corrected in
              the app. Every time you fix a category (or accept one the
              model guessed), that example is stored, and the model is
              retrained so the *next* statement you import gets smarter.

Nothing here talks to the network — everything runs locally.
"""
import json
import re
import os
import joblib
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline

MIN_CONFIDENCE = 0.45  # below this, ML prediction is treated as "not sure"
UNCATEGORIZED = "Uncategorized"


def clean_text(particulars):
    """Strip volatile bits (UPI reference numbers, dates) that don't help
    generalization, so 'ZEPTO .../994499078627/...' and
    '.../090274859129/...' both reduce to the same signal."""
    t = particulars
    t = re.sub(r"\b\d{6,}\b", " ", t)          # long reference numbers
    t = re.sub(r"\b\d{2}-\d{2}-\d{4}\b", " ", t)  # dates
    t = re.sub(r"[/_]+", " ", t)
    t = re.sub(r"\s+", " ", t).strip().upper()
    return t


class RuleEngine:
    def __init__(self, rules_path):
        self.rules_path = rules_path
        self.rules = []
        self.reload()

    def reload(self):
        with open(self.rules_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        compiled = []
        for r in data.get("rules", []):
            try:
                compiled.append((re.compile(r["pattern"], re.IGNORECASE), r["category"]))
            except re.error:
                continue
        self.rules = compiled

    def match(self, particulars):
        for pattern, category in self.rules:
            if pattern.search(particulars):
                return category
        return None


class MLCategorizer:
    """Wraps a TF-IDF + LogisticRegression pipeline. Persists to disk with
    joblib so it survives between app runs, and retrains from scratch on
    the full accumulated training set each time you call train() — cheap
    at the scale of a personal bank statement (thousands of rows, not
    millions)."""

    def __init__(self, model_path):
        self.model_path = model_path
        self.pipeline = None
        self.classes_ = []
        self.load()

    def load(self):
        if os.path.exists(self.model_path):
            try:
                self.pipeline = joblib.load(self.model_path)
                self.classes_ = list(self.pipeline.named_steps["clf"].classes_)
            except Exception:
                self.pipeline = None
                self.classes_ = []

    def save(self):
        if self.pipeline is not None:
            joblib.dump(self.pipeline, self.model_path)

    def train(self, texts, labels):
        """texts/labels: parallel lists of cleaned particulars & confirmed
        categories. Requires at least 2 distinct categories to fit."""
        distinct = set(labels)
        if len(texts) < 2 or len(distinct) < 2:
            return False  # not enough signal yet

        pipeline = Pipeline([
            ("tfidf", TfidfVectorizer(
                analyzer="char_wb", ngram_range=(3, 5), min_df=1, sublinear_tf=True
            )),
            ("clf", LogisticRegression(max_iter=2000, class_weight="balanced")),
        ])
        pipeline.fit(texts, labels)
        self.pipeline = pipeline
        self.classes_ = list(pipeline.named_steps["clf"].classes_)
        self.save()
        return True

    def predict(self, text):
        """Returns (category, confidence). If no model trained yet, returns
        (None, 0.0)."""
        if self.pipeline is None:
            return None, 0.0
        proba = self.pipeline.predict_proba([text])[0]
        idx = int(np.argmax(proba))
        return self.classes_[idx], float(proba[idx])


def normalize_counterparty(counterparty):
    """Loose key so 'Zepto', 'ZEPTO', 'zeptonow', 'Zepto Marketplace Pri'
    all collapse close enough to share a memory entry. We take the first
    alphabetic 'word' of decent length, which for merchant names is
    usually the brand."""
    c = re.sub(r"[^A-Za-z ]", " ", counterparty).upper().strip()
    words = [w for w in c.split() if len(w) >= 3]
    return words[0] if words else c


class CounterpartyMemory:
    """Exact/near-exact recall: once you've confirmed a category for a
    counterparty (a merchant or a person), every future transaction from
    that same counterparty is tagged instantly — no ML guesswork needed.
    This is what makes the app feel like it 'remembers' after the first
    correction."""

    def __init__(self):
        self.memory = {}  # normalized counterparty -> category

    def build(self, examples):
        """examples: list of (counterparty, category). Uses the most
        common confirmed category per counterparty."""
        from collections import Counter
        votes = {}
        for counterparty, category in examples:
            key = normalize_counterparty(counterparty)
            if not key:
                continue
            votes.setdefault(key, Counter())[category] += 1
        self.memory = {k: v.most_common(1)[0][0] for k, v in votes.items()}

    def lookup(self, counterparty):
        key = normalize_counterparty(counterparty)
        return self.memory.get(key)


class Categorizer:
    """Combines rules (authoritative) > counterparty memory (learned,
    high-confidence recall) > ML (learned, fuzzy fallback for names never
    seen before)."""

    def __init__(self, rules_path, model_path):
        self.rules = RuleEngine(rules_path)
        self.ml = MLCategorizer(model_path)
        self.memory = CounterpartyMemory()

    def categorize(self, particulars, counterparty=""):
        """Returns (category, source, confidence) where source is one of
        'rule', 'memory', 'ml', 'none'."""
        rule_cat = self.rules.match(particulars)
        if rule_cat:
            return rule_cat, "rule", 1.0

        if counterparty:
            mem_cat = self.memory.lookup(counterparty)
            if mem_cat:
                return mem_cat, "memory", 0.95

        cleaned = clean_text(particulars)
        ml_cat, conf = self.ml.predict(cleaned)
        if ml_cat and conf >= MIN_CONFIDENCE:
            return ml_cat, "ml", conf

        return UNCATEGORIZED, "none", 0.0

    def retrain(self, training_examples):
        """training_examples: list of (particulars, counterparty, category)
        tuples pulled from every transaction the user has confirmed or
        corrected across all imported statements. Rebuilds both the
        counterparty memory and refits the ML model."""
        self.memory.build([(cp, c) for _, cp, c in training_examples])
        texts = [clean_text(p) for p, _, _ in training_examples]
        labels = [c for _, _, c in training_examples]
        return self.ml.train(texts, labels)
