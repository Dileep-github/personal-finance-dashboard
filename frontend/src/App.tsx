import { useState } from 'react';
import ImportTab from './components/ImportTab';
import StatementView from './components/StatementView';
import './App.css';

type Tab = 'import' | 'statement';

function App() {
  const [tab, setTab] = useState<Tab>('import');
  const [reviewOnly, setReviewOnly] = useState(false);

  return (
    <div className="app">
      <nav className="tabs">
        <button className={tab === 'import' ? 'active' : ''} onClick={() => setTab('import')}>
          Import
        </button>
        <button className={tab === 'statement' ? 'active' : ''} onClick={() => setTab('statement')}>
          Statement
        </button>
      </nav>
      <main className="app-body">
        {tab === 'import' && (
          <ImportTab
            onImported={() => {
              setReviewOnly(true);
              setTab('statement');
            }}
          />
        )}
        {tab === 'statement' && (
          <StatementView reviewOnly={reviewOnly} setReviewOnly={setReviewOnly} />
        )}
      </main>
    </div>
  );
}

export default App;
