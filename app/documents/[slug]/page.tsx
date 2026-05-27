import { notFound } from 'next/navigation';
import fs from 'fs';
import path from 'path';
import type { DocumentData } from '@/types/document';
import DocumentReader from '@/components/DocumentReader';

export async function generateStaticParams() {
  const catalogPath = path.join(process.cwd(), 'content/documents/index.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  return catalog.map((d: { slug: string }) => ({ slug: d.slug }));
}

export default async function DocumentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const docPath = path.join(process.cwd(), 'content', 'documents', `${slug}.json`);
  if (!fs.existsSync(docPath)) return notFound();
  const doc: DocumentData = JSON.parse(fs.readFileSync(docPath, 'utf8'));
  return <DocumentReader doc={doc} />;
}
