import { useRef, useState } from 'react';
import { importStatement } from '../api/client';

interface Props {
  onImported: () => void;
}

const INTRO =
  'Pick a bank statement PDF and click Import.\n' +
  "Every transaction is categorized automatically using your rules, your learned " +
  'counterparty memory, and the ML model — in that order. New/unclear ones land in ' +
  'the Transactions tab for you to confirm or correct.';

export default function ImportTab({ onImported }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([INTRO]);
  const [importing, setImporting] = useState(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setFileName(file ? file.name : null);
  }

  async function handleImport() {
    const file = fileInput.current?.files?.[0];
    if (!file) return;
    setImporting(true);
    setLogLines((prev) => [...prev, `Parsing ${file.name} …`]);
    try {
      const result = await importStatement(file);
      // result.log[0] repeats the "Parsing …" line already shown above.
      setLogLines((prev) => [...prev, ...result.log.slice(1)]);
      onImported();
    } catch (e) {
      setLogLines((prev) => [...prev, e instanceof Error ? e.message : String(e)]);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="tab-panel">
      <div className="import-toolbar">
        <label className="file-picker-button">
          Browse PDF…
          <input ref={fileInput} type="file" accept=".pdf" onChange={handleFileChange} hidden />
        </label>
        <span className="file-name">{fileName ?? 'No file selected'}</span>
      </div>
      <button className="import-button" onClick={handleImport} disabled={!fileName || importing}>
        {importing ? 'Importing…' : 'Import Statement'}
      </button>
      <div className="import-log">
        {logLines.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
    </div>
  );
}
