import type { ReactNode } from 'react';

export interface Band {
  title: string;
  meta: string;
}

const cssString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')}"`;

/**
 * §9.2: the paper (landscape, 10 mm margins), the header band (name left; dates and Prepared by right) and the
 * footer on every printed page, from @page margin boxes. Print Gantt (§9.4) passes its paper.
 */
export function PrintChrome({ left, right, footer, size = 'A4 landscape' }: { left: string; right: string; footer: string; size?: string }) {
  const box = 'font-family: "IBM Plex Sans", "IBM Plex Sans Thai", "Leelawadee UI", sans-serif; font-size: 8.5pt;';
  return (
    <style>{`@media print {
  @page {
    size: ${size};
    margin: 10mm;
    @top-left { content: ${cssString(left)}; ${box} font-weight: 600; }
    @top-right { content: ${cssString(right)}; ${box} }
    @bottom-center { content: ${cssString(`${footer} · Page `)} counter(page); ${box} }
  }
}`}</style>
  );
}

/** One report page (SPEC §9.2). The band shows on screen only; print gets it from the @page margin boxes. */
export function Page({ band, children, className }: { band: Band; children: ReactNode; className?: string }) {
  return (
    <section className={className ? `report-page ${className}` : 'report-page'}>
      <header className="page-band">
        <span className="page-band-title">{band.title}</span>
        <span>{band.meta}</span>
      </header>
      {children}
    </section>
  );
}
