import './globals.css';

export const metadata = {
  title: 'इटहरी उपमहानगरपालिका — योजना अनुगमन',
  description: 'ठेक्का तथा योजना अनुगमन ड्यासबोर्ड',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ne">
      <head>
        {/* Preconnect so DNS + TLS are resolved before the stylesheet fires */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />

        {/*
          display=block (not swap): prevents iOS WebKit from locking SVG text
          to the fallback font at first paint and never re-shaping.
          Trade-off: tiny delay on first load; charts always render correctly.
        */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600;700&family=Mukta:wght@400;600;700;800&display=block"
        />

        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
      </head>
      <body>{children}</body>
    </html>
  );
}
