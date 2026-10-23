import { Link } from 'react-router-dom';
import { useWorkspaceCtx } from './WorkspaceShell';
import { Section } from '../components/Basics';

export function CasesPage() {
  const { wsId } = useWorkspaceCtx();
  return (
    <div className="page">
      <div className="page-head"><div><h1>Cases &amp; Investigations</h1><p>Organise findings into cases that can be handed to a customer or a legal team.</p></div></div>
      <Section className="placeholder">
        <h2 style={{ marginBottom: 6 }}>Coming next</h2>
        <p className="muted">Cases are the next milestone of Audit Explorer. The data model is designed; nothing is shown here yet so that no placeholder numbers can be mistaken for evidence.</p>
        <ul>
          <li><strong>Linked evidence</strong> — pin events, sign-in sessions, messages and people to a case straight from the inspector.</li>
          <li><strong>Analyst notes</strong> — timestamped notes with author, kept next to the evidence they explain.</li>
          <li><strong>Saved searches</strong> — store a Global Activity view (query, filters, date range) and re-run it after each import.</li>
          <li><strong>Exportable reports</strong> — a timeline and summary document built from the linked evidence, with the raw records attached.</li>
        </ul>
        <p className="small muted" style={{ marginTop: 12 }}>Until then, every Global Activity view is shareable as a URL — all filters live in the address bar — and <Link to={`/w/${wsId}/activity`}>Export CSV</Link> produces an evidence file for the current filters.</p>
      </Section>
    </div>
  );
}
