import Link from 'next/link';
import catalog from '@/content/documents/index.json';
import type { DocumentMeta } from '@/types/document';
import HomeThemeToggle from '@/components/HomeThemeToggle';

export default function HomePage() {
  const docs = catalog as DocumentMeta[];

  return (
    <div className="home-page">
      <HomeThemeToggle />
      <header className="home-header">
        <div className="home-title">✦ ENCYCLICALS</div>
        <div className="home-subtitle">Catholic Doctrine &amp; Social Teaching</div>
      </header>
      <div className="home-body">
        <div className="home-section-title">Documents</div>
        <div className="doc-grid">
          {docs.map((doc) => (
            <Link key={doc.slug} href={`/documents/${doc.slug}`} className="doc-card">
              <div className="doc-card-type">{doc.type}</div>
              <div className="doc-card-title">{doc.title}</div>
              <div className="doc-card-author">{doc.author}</div>
              <div className="doc-card-date">{doc.dateDisplay}</div>
              <div className="doc-card-summary">{doc.summary}</div>
              <div className="doc-card-cta">Read →</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
