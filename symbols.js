// ============================================================
// symbols.js — Bibliothèque de symboles SVG architecturaux
// Vue en plan (de dessus), normalisée sur viewBox "0 0 100 X"
// ============================================================

const SYMBOL_CATEGORIES = [

  // ── Architecture ─────────────────────────────────────────────
  {
    id: 'architecture',
    label: '🏗️ Architecture',
    symbols: [
      {
        id: 'porte-simple',
        label: 'Porte simple',
        defaultW: 90, defaultH: 90,
        realW_cm: 83, realH_cm: 83,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 90">
  <line x1="4" y1="4" x2="4" y2="86" stroke="black" stroke-width="8"/>
  <line x1="4" y1="4" x2="86" y2="4" stroke="black" stroke-width="3"/>
  <path d="M 86 4 A 82 82 0 0 1 4 86" fill="none" stroke="black" stroke-width="1.5" stroke-dasharray="4,3"/>
</svg>`
      },
      {
        id: 'porte-double',
        label: 'Porte double',
        defaultW: 160, defaultH: 83,
        realW_cm: 160, realH_cm: 83,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 83">
  <g transform="scale(1,0.922)">
  <line x1="4" y1="4" x2="4" y2="86" stroke="black" stroke-width="8"/>
  <line x1="156" y1="4" x2="156" y2="86" stroke="black" stroke-width="8"/>
  <line x1="4" y1="4" x2="82" y2="4" stroke="black" stroke-width="3"/>
  <line x1="78" y1="4" x2="156" y2="4" stroke="black" stroke-width="3"/>
  <path d="M 82 4 A 78 78 0 0 1 4 82" fill="none" stroke="black" stroke-width="1.5" stroke-dasharray="4,3"/>
  <path d="M 78 4 A 78 78 0 0 0 156 82" fill="none" stroke="black" stroke-width="1.5" stroke-dasharray="4,3"/>
  </g>
</svg>`
      },
      {
        id: 'fenetre',
        label: 'Fenêtre',
        defaultW: 120, defaultH: 20,
        realW_cm: 120, realH_cm: 20,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 20">
  <rect x="0" y="0" width="120" height="20" fill="white" stroke="black" stroke-width="2"/>
  <line x1="0" y1="6" x2="120" y2="6" stroke="black" stroke-width="1"/>
  <line x1="0" y1="14" x2="120" y2="14" stroke="black" stroke-width="1"/>
</svg>`
      },
      {
        id: 'escalier',
        label: 'Escalier',
        defaultW: 100, defaultH: 270,
        realW_cm: 100, realH_cm: 270,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 270">
  <g transform="scale(1,1.5)">
  <rect x="4" y="4" width="92" height="172" fill="white" stroke="black" stroke-width="2"/>
  <line x1="4" y1="22" x2="96" y2="22" stroke="black" stroke-width="1"/>
  <line x1="4" y1="40" x2="96" y2="40" stroke="black" stroke-width="1"/>
  <line x1="4" y1="58" x2="96" y2="58" stroke="black" stroke-width="1"/>
  <line x1="4" y1="76" x2="96" y2="76" stroke="black" stroke-width="1"/>
  <line x1="4" y1="94" x2="96" y2="94" stroke="black" stroke-width="1"/>
  <line x1="4" y1="112" x2="96" y2="112" stroke="black" stroke-width="1"/>
  <line x1="4" y1="130" x2="96" y2="130" stroke="black" stroke-width="1"/>
  <line x1="4" y1="148" x2="96" y2="148" stroke="black" stroke-width="1"/>
  <line x1="4" y1="166" x2="96" y2="166" stroke="black" stroke-width="1"/>
  <line x1="50" y1="170" x2="50" y2="10" stroke="black" stroke-width="1.5"/>
  <polygon points="50,6 44,16 56,16" fill="black"/>
  </g>
</svg>`
      },
      {
        id: 'colonne',
        label: 'Poteau/Colonne',
        defaultW: 30, defaultH: 30,
        realW_cm: 20, realH_cm: 20,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30">
  <rect x="2" y="2" width="26" height="26" fill="#888" stroke="black" stroke-width="2"/>
</svg>`
      },
      {
        id: 'cheminee',
        label: 'Cheminée',
        defaultW: 120, defaultH: 40,
        realW_cm: 120, realH_cm: 40,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40">
  <g transform="scale(1,0.8)">
  <rect x="3" y="3" width="114" height="44" fill="white" stroke="black" stroke-width="2"/>
  <rect x="22" y="10" width="76" height="24" rx="3" fill="#ccc" stroke="black" stroke-width="1.5"/>
  <rect x="30" y="15" width="60" height="14" fill="#888" stroke="black" stroke-width="1"/>
  <line x1="22" y1="10" x2="3"   y2="3"  stroke="black" stroke-width="1"/>
  <line x1="98" y1="10" x2="117" y2="3"  stroke="black" stroke-width="1"/>
  <line x1="22" y1="34" x2="3"   y2="47" stroke="black" stroke-width="1"/>
  <line x1="98" y1="34" x2="117" y2="47" stroke="black" stroke-width="1"/>
  </g>
</svg>`
      }
    ]
  },

  // ── Chambre & rangement ───────────────────────────────────────
  {
    id: 'chambre',
    label: '🛏️ Chambre & rangement',
    symbols: [
      {
        id: 'lit-simple',
        label: 'Lit simple',
        defaultW: 90, defaultH: 190,
        realW_cm: 90, realH_cm: 200,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 190">
  <rect x="4" y="4" width="82" height="182" rx="4" fill="white" stroke="black" stroke-width="2"/>
  <rect x="4" y="4" width="82" height="28" rx="4" fill="#ddd" stroke="black" stroke-width="1.5"/>
  <rect x="15" y="38" width="60" height="38" rx="8" fill="white" stroke="black" stroke-width="1.5"/>
</svg>`
      },
      {
        id: 'lit-double',
        label: 'Lit double',
        defaultW: 140, defaultH: 200,
        realW_cm: 140, realH_cm: 200,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 200">
  <g transform="scale(0.875,1.053)">
  <rect x="4" y="4" width="152" height="182" rx="4" fill="white" stroke="black" stroke-width="2"/>
  <rect x="4" y="4" width="152" height="28" rx="4" fill="#ddd" stroke="black" stroke-width="1.5"/>
  <line x1="80" y1="32" x2="80" y2="186" stroke="black" stroke-width="1" stroke-dasharray="4,4"/>
  <rect x="14" y="38" width="55" height="35" rx="8" fill="white" stroke="black" stroke-width="1.5"/>
  <rect x="91" y="38" width="55" height="35" rx="8" fill="white" stroke="black" stroke-width="1.5"/>
  </g>
</svg>`
      },
      {
        id: 'lit-enfant',
        label: 'Lit enfant',
        defaultW: 80, defaultH: 160,
        realW_cm: 70, realH_cm: 140,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 160">
  <rect x="3" y="3" width="74" height="154" rx="5" fill="white" stroke="black" stroke-width="2"/>
  <rect x="3" y="3" width="74" height="20" rx="5" fill="none" stroke="black" stroke-width="2"/>
  <line x1="3" y1="143" x2="77" y2="143" stroke="black" stroke-width="1.5"/>
</svg>`
      },
      {
        id: 'armoire',
        label: 'Armoire',
        defaultW: 200, defaultH: 60,
        realW_cm: 200, realH_cm: 60,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60">
  <rect x="4" y="4" width="192" height="52" fill="white" stroke="black" stroke-width="2"/>
  <line x1="100" y1="4" x2="100" y2="56" stroke="black" stroke-width="1.5"/>
  <circle cx="88" cy="30" r="4" fill="none" stroke="black" stroke-width="1.5"/>
  <circle cx="112" cy="30" r="4" fill="none" stroke="black" stroke-width="1.5"/>
</svg>`
      },
      {
        id: 'dressing',
        label: 'Dressing',
        defaultW: 200, defaultH: 60,
        realW_cm: 200, realH_cm: 60,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60">
  <g transform="scale(1.25,1)">
  <rect x="3" y="3" width="154" height="54" fill="white" stroke="black" stroke-width="2"/>
  <line x1="83" y1="3" x2="83" y2="57" stroke="black" stroke-width="1"/>
  <path d="M3,57 A80,80 0 0,0 83,3" fill="none" stroke="black" stroke-width="1" stroke-dasharray="4,3"/>
  <path d="M83,57 A80,80 0 0,1 157,3" fill="none" stroke="black" stroke-width="1" stroke-dasharray="4,3"/>
  </g>
</svg>`
      },
      {
        id: 'pax-100',
        label: 'PAX 100×58',
        defaultW: 100, defaultH: 58,
        realW_cm: 100, realH_cm: 58,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 58">
  <rect x="2" y="2" width="96" height="54" fill="white" stroke="black" stroke-width="2"/>
  <!-- rail avant -->
  <line x1="2" y1="52" x2="98" y2="52" stroke="black" stroke-width="1.5"/>
  <!-- rail arrière -->
  <line x1="2" y1="8"  x2="98" y2="8"  stroke="black" stroke-width="1"/>
  <!-- panneau gauche coulissant -->
  <rect x="4"  y="8" width="46" height="44" fill="none" stroke="black" stroke-width="1" stroke-dasharray="4,2"/>
  <!-- panneau droit coulissant -->
  <rect x="50" y="8" width="46" height="44" fill="none" stroke="black" stroke-width="1" stroke-dasharray="4,2"/>
  <!-- poignée gauche -->
  <line x1="42" y1="26" x2="42" y2="34" stroke="black" stroke-width="2"/>
  <!-- poignée droite -->
  <line x1="58" y1="26" x2="58" y2="34" stroke="black" stroke-width="2"/>
</svg>`
      },
      {
        id: 'pax-50',
        label: 'PAX 50×58',
        defaultW: 50, defaultH: 58,
        realW_cm: 50, realH_cm: 58,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 58">
  <rect x="2" y="2" width="46" height="54" fill="white" stroke="black" stroke-width="2"/>
  <!-- rail avant -->
  <line x1="2" y1="52" x2="48" y2="52" stroke="black" stroke-width="1.5"/>
  <!-- rail arrière -->
  <line x1="2" y1="8"  x2="48" y2="8"  stroke="black" stroke-width="1"/>
  <!-- panneau coulissant unique -->
  <rect x="4" y="8" width="42" height="44" fill="none" stroke="black" stroke-width="1" stroke-dasharray="4,2"/>
  <!-- poignée -->
  <line x1="22" y1="26" x2="22" y2="34" stroke="black" stroke-width="2"/>
</svg>`
      }
    ]
  },

  // ── Séjour & bureau ───────────────────────────────────────────
  {
    id: 'sejour',
    label: '🛋️ Séjour & bureau',
    symbols: [
      {
        id: 'canape',
        label: 'Canapé 3 places',
        defaultW: 210, defaultH: 90,
        realW_cm: 220, realH_cm: 90,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 90">
  <rect x="4" y="4" width="202" height="30" rx="6" fill="#ddd" stroke="black" stroke-width="2"/>
  <rect x="4" y="34" width="202" height="42" rx="4" fill="white" stroke="black" stroke-width="2"/>
  <rect x="4" y="34" width="18" height="42" rx="4" fill="#ccc" stroke="black" stroke-width="1.5"/>
  <rect x="188" y="34" width="18" height="42" rx="4" fill="#ccc" stroke="black" stroke-width="1.5"/>
  <line x1="74" y1="34" x2="74" y2="76" stroke="black" stroke-width="1"/>
  <line x1="136" y1="34" x2="136" y2="76" stroke="black" stroke-width="1"/>
</svg>`
      },
      {
        id: 'canape-angle',
        label: 'Canapé angle',
        defaultW: 160, defaultH: 160,
        realW_cm: 240, realH_cm: 240,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
  <path d="M3,3 L157,3 L157,90 L90,90 L90,157 L3,157 Z" fill="white" stroke="black" stroke-width="2"/>
  <path d="M14,14 L146,14 L146,79 L79,79 L79,146 L14,146 Z" fill="none" stroke="black" stroke-width="1"/>
  <rect x="3" y="3" width="18" height="87" rx="4" fill="none" stroke="black" stroke-width="1.5"/>
  <rect x="3" y="139" width="87" height="18" rx="4" fill="none" stroke="black" stroke-width="1.5"/>
</svg>`
      },
      {
        id: 'fauteuil',
        label: 'Fauteuil',
        defaultW: 80, defaultH: 80,
        realW_cm: 80, realH_cm: 80,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">
  <rect x="8" y="4" width="64" height="18" rx="6" fill="#ddd" stroke="black" stroke-width="2"/>
  <rect x="8" y="22" width="64" height="44" rx="4" fill="white" stroke="black" stroke-width="2"/>
  <rect x="4" y="22" width="12" height="44" rx="4" fill="#ccc" stroke="black" stroke-width="1.5"/>
  <rect x="64" y="22" width="12" height="44" rx="4" fill="#ccc" stroke="black" stroke-width="1.5"/>
</svg>`
      },
      {
        id: 'table-basse',
        label: 'Table basse',
        defaultW: 120, defaultH: 60,
        realW_cm: 120, realH_cm: 60,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60">
  <g transform="scale(0.923,0.75)">
  <rect x="3" y="3" width="124" height="74" rx="5" fill="white" stroke="black" stroke-width="2"/>
  <rect x="10" y="10" width="110" height="60" rx="3" fill="none" stroke="black" stroke-width="1"/>
  </g>
</svg>`
      },
      {
        id: 'tv-murale',
        label: 'TV murale',
        defaultW: 120, defaultH: 12,
        realW_cm: 120, realH_cm: 12,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 12">
  <g transform="scale(0.8,0.4)">
  <rect x="3" y="3" width="144" height="24" fill="white" stroke="black" stroke-width="2"/>
  <rect x="8" y="7" width="134" height="16" fill="none" stroke="black" stroke-width="1"/>
  <line x1="3" y1="3" x2="147" y2="27" stroke="black" stroke-width="0.5"/>
  <line x1="147" y1="3" x2="3" y2="27" stroke="black" stroke-width="0.5"/>
  </g>
</svg>`
      },
      {
        id: 'tv-meuble',
        label: 'Meuble TV',
        defaultW: 160, defaultH: 55,
        realW_cm: 160, realH_cm: 45,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 55">
  <rect x="3" y="3" width="154" height="49" fill="white" stroke="black" stroke-width="2"/>
  <rect x="8" y="8" width="64" height="39" fill="none" stroke="black" stroke-width="1"/>
  <rect x="80" y="8" width="74" height="39" fill="none" stroke="black" stroke-width="1"/>
  <line x1="3" y1="46" x2="157" y2="46" stroke="black" stroke-width="1.5"/>
</svg>`
      },
      {
        id: 'table-ronde',
        label: 'Table ronde',
        defaultW: 110, defaultH: 110,
        realW_cm: 110, realH_cm: 110,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 110 110">
  <circle cx="55" cy="55" r="48" fill="white" stroke="black" stroke-width="2"/>
  <rect x="40" y="2" width="30" height="14" rx="3" fill="#eee" stroke="black" stroke-width="1.5"/>
  <rect x="40" y="94" width="30" height="14" rx="3" fill="#eee" stroke="black" stroke-width="1.5"/>
  <rect x="2" y="40" width="14" height="30" rx="3" fill="#eee" stroke="black" stroke-width="1.5"/>
  <rect x="94" y="40" width="14" height="30" rx="3" fill="#eee" stroke="black" stroke-width="1.5"/>
</svg>`
      },
      {
        id: 'table-rect',
        label: 'Table rectangulaire',
        defaultW: 160, defaultH: 80,
        realW_cm: 160, realH_cm: 80,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 80">
  <g transform="scale(1,0.889)">
  <rect x="22" y="22" width="116" height="46" fill="white" stroke="black" stroke-width="2"/>
  <rect x="36" y="5" width="24" height="14" rx="3" fill="#eee" stroke="black" stroke-width="1.5"/>
  <rect x="100" y="5" width="24" height="14" rx="3" fill="#eee" stroke="black" stroke-width="1.5"/>
  <rect x="36" y="71" width="24" height="14" rx="3" fill="#eee" stroke="black" stroke-width="1.5"/>
  <rect x="100" y="71" width="24" height="14" rx="3" fill="#eee" stroke="black" stroke-width="1.5"/>
  <rect x="5" y="30" width="14" height="30" rx="3" fill="#eee" stroke="black" stroke-width="1.5"/>
  <rect x="141" y="30" width="14" height="30" rx="3" fill="#eee" stroke="black" stroke-width="1.5"/>
  </g>
</svg>`
      },
      {
        id: 'table-a-manger',
        label: 'Table à manger',
        defaultW: 200, defaultH: 90,
        realW_cm: 200, realH_cm: 90,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 90">
  <g transform="scale(1,0.818)">
  <rect x="24" y="22" width="152" height="66" fill="white" stroke="black" stroke-width="2"/>
  <rect x="30" y="5"  width="28" height="14" rx="3" fill="#eee" stroke="black" stroke-width="1.5"/>
  <rect x="86" y="5"  width="28" height="14" rx="3" fill="#eee" stroke="black" stroke-width="1.5"/>
  <rect x="142" y="5" width="28" height="14" rx="3" fill="#eee" stroke="black" stroke-width="1.5"/>
  <rect x="30" y="91"  width="28" height="14" rx="3" fill="#eee" stroke="black" stroke-width="1.5"/>
  <rect x="86" y="91"  width="28" height="14" rx="3" fill="#eee" stroke="black" stroke-width="1.5"/>
  <rect x="142" y="91" width="28" height="14" rx="3" fill="#eee" stroke="black" stroke-width="1.5"/>
  <rect x="5"   y="38" width="14" height="34" rx="3" fill="#eee" stroke="black" stroke-width="1.5"/>
  <rect x="181" y="38" width="14" height="34" rx="3" fill="#eee" stroke="black" stroke-width="1.5"/>
  </g>
</svg>`
      },
      {
        id: 'chaise',
        label: 'Chaise',
        defaultW: 45, defaultH: 45,
        realW_cm: 45, realH_cm: 45,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45">
  <g transform="scale(1,0.9)">
  <rect x="5" y="4" width="35" height="14" rx="4" fill="#ddd" stroke="black" stroke-width="1.5"/>
  <rect x="5" y="18" width="35" height="28" rx="4" fill="white" stroke="black" stroke-width="1.5"/>
  </g>
</svg>`
      },
      {
        id: 'tabouret',
        label: 'Tabouret',
        defaultW: 50, defaultH: 50,
        realW_cm: 40, realH_cm: 40,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50">
  <circle cx="25" cy="25" r="21" fill="white" stroke="black" stroke-width="2"/>
  <circle cx="25" cy="25" r="10" fill="none" stroke="black" stroke-width="1"/>
  <line x1="10" y1="10" x2="40" y2="40" stroke="black" stroke-width="1"/>
  <line x1="40" y1="10" x2="10" y2="40" stroke="black" stroke-width="1"/>
</svg>`
      },
      {
        id: 'bureau',
        label: 'Bureau',
        defaultW: 140, defaultH: 70,
        realW_cm: 140, realH_cm: 70,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 70">
  <rect x="4" y="4" width="132" height="62" fill="white" stroke="black" stroke-width="2"/>
  <rect x="100" y="10" width="30" height="20" rx="2" fill="none" stroke="black" stroke-width="1.5"/>
  <rect x="100" y="34" width="30" height="24" rx="2" fill="none" stroke="black" stroke-width="1.5"/>
  <line x1="112" y1="20" x2="120" y2="20" stroke="black" stroke-width="1.5"/>
  <line x1="112" y1="46" x2="120" y2="46" stroke="black" stroke-width="1.5"/>
</svg>`
      },
      {
        id: 'bureau-angle',
        label: 'Bureau angle',
        defaultW: 160, defaultH: 160,
        realW_cm: 160, realH_cm: 160,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
  <path d="M3,3 L157,3 L157,80 L80,80 L80,157 L3,157 Z" fill="white" stroke="black" stroke-width="2"/>
  <path d="M3,67 L67,67 L67,157" fill="none" stroke="black" stroke-width="1.5"/>
</svg>`
      }
    ]
  },

  // ── Cuisine ───────────────────────────────────────────────────
  {
    id: 'cuisine',
    label: '🍳 Cuisine',
    symbols: [
      {
        id: 'meuble-bas-60',
        label: 'Meuble bas 60',
        defaultW: 80, defaultH: 80,
        realW_cm: 60, realH_cm: 60,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">
  <rect x="3" y="3" width="74" height="74" fill="white" stroke="black" stroke-width="2"/>
  <line x1="3" y1="66" x2="77" y2="66" stroke="black" stroke-width="2"/>
  <line x1="3" y1="72" x2="77" y2="72" stroke="black" stroke-width="1"/>
  <circle cx="40" cy="69" r="2.5" fill="black"/>
</svg>`
      },
      {
        id: 'meuble-bas-120',
        label: 'Meuble bas 120',
        defaultW: 160, defaultH: 80,
        realW_cm: 120, realH_cm: 60,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 80">
  <rect x="3" y="3" width="154" height="74" fill="white" stroke="black" stroke-width="2"/>
  <line x1="3" y1="66" x2="157" y2="66" stroke="black" stroke-width="2"/>
  <line x1="80" y1="3" x2="80" y2="66" stroke="black" stroke-width="1"/>
  <circle cx="62" cy="69" r="2.5" fill="black"/>
  <circle cx="98" cy="69" r="2.5" fill="black"/>
</svg>`
      },
      {
        id: 'meuble-haut-60',
        label: 'Meuble haut 60',
        defaultW: 60, defaultH: 35,
        realW_cm: 60, realH_cm: 35,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 35">
  <g transform="scale(0.75,0.875)">
  <rect x="3" y="3" width="74" height="34" fill="white" stroke="black" stroke-width="2" stroke-dasharray="6,3"/>
  <line x1="3" y1="29" x2="77" y2="29" stroke="black" stroke-width="1.5" stroke-dasharray="6,3"/>
  <circle cx="40" cy="32" r="2" fill="black"/>
  </g>
</svg>`
      },
      {
        id: 'placard-bas-60',
        label: 'Placard bas 60',
        defaultW: 80, defaultH: 80,
        realW_cm: 60, realH_cm: 60,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">
  <rect x="3" y="3" width="74" height="74" fill="white" stroke="black" stroke-width="2"/>
  <line x1="3" y1="66" x2="77" y2="66" stroke="black" stroke-width="2"/>
  <line x1="3" y1="3" x2="77" y2="66" stroke="black" stroke-width="1"/>
  <line x1="77" y1="3" x2="3" y2="66" stroke="black" stroke-width="1"/>
</svg>`
      },
      {
        id: 'placard-haut-60',
        label: 'Placard haut 60',
        defaultW: 80, defaultH: 40,
        realW_cm: 60, realH_cm: 35,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 40">
  <rect x="3" y="3" width="74" height="34" fill="white" stroke="black" stroke-width="2" stroke-dasharray="6,3"/>
  <line x1="3" y1="3" x2="77" y2="37" stroke="black" stroke-width="1" stroke-dasharray="6,3"/>
  <line x1="77" y1="3" x2="3" y2="37" stroke="black" stroke-width="1" stroke-dasharray="6,3"/>
</svg>`
      },
      {
        id: 'plan-travail-angle',
        label: 'Angle plan de travail',
        defaultW: 120, defaultH: 120,
        realW_cm: 90, realH_cm: 90,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
  <path d="M3,3 L117,3 L117,57 L57,57 L57,117 L3,117 Z" fill="white" stroke="black" stroke-width="2"/>
  <path d="M3,51 L51,51 L51,117" fill="none" stroke="black" stroke-width="1.5"/>
  <path d="M3,57 L57,3" fill="none" stroke="black" stroke-width="1" stroke-dasharray="4,3"/>
</svg>`
      },
      {
        id: 'evier-simple-60',
        label: 'Évier simple 60',
        defaultW: 60, defaultH: 50,
        realW_cm: 60, realH_cm: 50,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 50">
  <g transform="scale(0.75,0.625)">
  <rect x="3" y="3" width="74" height="74" fill="white" stroke="black" stroke-width="2"/>
  <rect x="10" y="10" width="60" height="60" rx="5" fill="none" stroke="black" stroke-width="1.5"/>
  <circle cx="40" cy="40" r="8" fill="none" stroke="black" stroke-width="1.5"/>
  <line x1="32" y1="40" x2="48" y2="40" stroke="black" stroke-width="1"/>
  <line x1="40" y1="32" x2="40" y2="48" stroke="black" stroke-width="1"/>
  </g>
</svg>`
      },
      {
        id: 'evier-double',
        label: 'Évier double',
        defaultW: 120, defaultH: 50,
        realW_cm: 120, realH_cm: 50,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 50">
  <g transform="scale(1,0.909)">
  <rect x="4" y="4" width="112" height="47" rx="4" fill="white" stroke="black" stroke-width="2"/>
  <rect x="10" y="10" width="46" height="35" rx="3" fill="none" stroke="black" stroke-width="1.5"/>
  <rect x="64" y="10" width="46" height="35" rx="3" fill="none" stroke="black" stroke-width="1.5"/>
  <circle cx="33" cy="27.5" r="4" fill="none" stroke="black" stroke-width="1.5"/>
  <circle cx="87" cy="27.5" r="4" fill="none" stroke="black" stroke-width="1.5"/>
  <circle cx="60" cy="8" r="3" fill="black"/>
  <line x1="52" y1="8" x2="68" y2="8" stroke="black" stroke-width="2"/>
  </g>
</svg>`
      },
      {
        id: 'plaque',
        label: 'Plaque cuisson',
        defaultW: 80, defaultH: 80,
        realW_cm: 60, realH_cm: 60,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">
  <rect x="4" y="4" width="72" height="72" rx="4" fill="white" stroke="black" stroke-width="2"/>
  <circle cx="22" cy="22" r="12" fill="none" stroke="black" stroke-width="1.5"/>
  <circle cx="22" cy="22" r="5" fill="none" stroke="black" stroke-width="1.5"/>
  <circle cx="58" cy="22" r="12" fill="none" stroke="black" stroke-width="1.5"/>
  <circle cx="58" cy="22" r="5" fill="none" stroke="black" stroke-width="1.5"/>
  <circle cx="22" cy="58" r="12" fill="none" stroke="black" stroke-width="1.5"/>
  <circle cx="22" cy="58" r="5" fill="none" stroke="black" stroke-width="1.5"/>
  <circle cx="58" cy="58" r="12" fill="none" stroke="black" stroke-width="1.5"/>
  <circle cx="58" cy="58" r="5" fill="none" stroke="black" stroke-width="1.5"/>
</svg>`
      },
      {
        id: 'four-encastre',
        label: 'Four encastré',
        defaultW: 80, defaultH: 80,
        realW_cm: 60, realH_cm: 60,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">
  <rect x="3" y="3" width="74" height="74" fill="white" stroke="black" stroke-width="2"/>
  <rect x="12" y="12" width="56" height="56" fill="none" stroke="black" stroke-width="1.5"/>
  <rect x="20" y="20" width="40" height="40" fill="none" stroke="black" stroke-width="1"/>
  <line x1="3" y1="72" x2="77" y2="72" stroke="black" stroke-width="2"/>
  <circle cx="40" cy="75" r="2" fill="black"/>
</svg>`
      },
      {
        id: 'lave-vaisselle',
        label: 'Lave-vaisselle',
        defaultW: 80, defaultH: 80,
        realW_cm: 60, realH_cm: 60,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">
  <rect x="3" y="3" width="74" height="74" fill="white" stroke="black" stroke-width="2"/>
  <line x1="3" y1="66" x2="77" y2="66" stroke="black" stroke-width="2"/>
  <circle cx="40" cy="35" r="20" fill="none" stroke="black" stroke-width="1.5"/>
  <path d="M25,28 Q32,22 40,35 Q48,48 55,42" fill="none" stroke="black" stroke-width="1"/>
  <circle cx="40" cy="69" r="2.5" fill="black"/>
</svg>`
      },
      {
        id: 'hotte',
        label: 'Hotte',
        defaultW: 90, defaultH: 55,
        realW_cm: 90, realH_cm: 55,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 55">
  <rect x="3" y="3" width="84" height="49" fill="white" stroke="black" stroke-width="2"/>
  <rect x="12" y="12" width="66" height="30" fill="none" stroke="black" stroke-width="1.5"/>
  <circle cx="27" cy="44" r="3" fill="none" stroke="black" stroke-width="1.5"/>
  <circle cx="45" cy="44" r="3" fill="none" stroke="black" stroke-width="1.5"/>
  <circle cx="63" cy="44" r="3" fill="none" stroke="black" stroke-width="1.5"/>
</svg>`
      },
      {
        id: 'frigo',
        label: 'Réfrigérateur',
        defaultW: 70, defaultH: 80,
        realW_cm: 60, realH_cm: 65,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 70 80">
  <rect x="4" y="4" width="62" height="72" rx="4" fill="white" stroke="black" stroke-width="2"/>
  <line x1="4" y1="32" x2="66" y2="32" stroke="black" stroke-width="1.5"/>
  <line x1="52" y1="12" x2="52" y2="28" stroke="black" stroke-width="2.5"/>
  <line x1="52" y1="40" x2="52" y2="70" stroke="black" stroke-width="2.5"/>
</svg>`
      }
    ]
  },

  // ── Salle de bain ─────────────────────────────────────────────
  {
    id: 'sdb',
    label: '🚿 Salle de bain',
    symbols: [
      {
        id: 'wc',
        label: 'WC',
        defaultW: 37, defaultH: 65,
        realW_cm: 37, realH_cm: 65,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 37 65">
  <g transform="scale(0.617,0.8125)">
  <rect x="4" y="4" width="52" height="18" rx="3" fill="white" stroke="black" stroke-width="2"/>
  <path d="M8,22 L52,22 Q56,22 56,50 Q56,76 30,76 Q4,76 4,50 Q4,22 8,22 Z" fill="white" stroke="black" stroke-width="2"/>
  <ellipse cx="30" cy="50" rx="16" ry="20" fill="none" stroke="black" stroke-width="1.5"/>
  </g>
</svg>`
      },
      {
        id: 'lavabo',
        label: 'Lavabo',
        defaultW: 65, defaultH: 50,
        realW_cm: 60, realH_cm: 45,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 65 50">
  <rect x="4" y="4" width="57" height="42" rx="10" fill="white" stroke="black" stroke-width="2"/>
  <ellipse cx="32" cy="28" rx="19" ry="13" fill="none" stroke="black" stroke-width="1.5"/>
  <circle cx="32" cy="11" r="3" fill="black"/>
  <line x1="24" y1="11" x2="40" y2="11" stroke="black" stroke-width="2"/>
</svg>`
      },
      {
        id: 'baignoire',
        label: 'Baignoire',
        defaultW: 70, defaultH: 160,
        realW_cm: 70, realH_cm: 160,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 70 160">
  <rect x="4" y="4" width="62" height="152" rx="10" fill="white" stroke="black" stroke-width="2"/>
  <ellipse cx="35" cy="88" rx="25" ry="58" fill="none" stroke="black" stroke-width="1.5"/>
  <circle cx="35" cy="18" r="5" fill="black"/>
  <circle cx="22" cy="18" r="3" fill="none" stroke="black" stroke-width="1.5"/>
  <circle cx="48" cy="18" r="3" fill="none" stroke="black" stroke-width="1.5"/>
</svg>`
      },
      {
        id: 'barriere-bain',
        label: 'Pare-baignoire',
        defaultW: 100, defaultH: 10,
        realW_cm: 100, realH_cm: 10,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 10">
  <g transform="scale(1,0.833)">
  <rect x="2" y="2" width="96" height="8" fill="white" stroke="black" stroke-width="2"/>
  <line x1="20" y1="2" x2="20" y2="10" stroke="black" stroke-width="1"/>
  <line x1="50" y1="2" x2="50" y2="10" stroke="black" stroke-width="1"/>
  <line x1="80" y1="2" x2="80" y2="10" stroke="black" stroke-width="1"/>
  </g>
</svg>`
      },
      {
        id: 'douche',
        label: 'Douche',
        defaultW: 90, defaultH: 90,
        realW_cm: 90, realH_cm: 90,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 90">
  <rect x="4" y="4" width="82" height="82" fill="white" stroke="black" stroke-width="2"/>
  <path d="M4,4 Q4,20 20,20 L4,20 Z" fill="none" stroke="black" stroke-width="1.5"/>
  <circle cx="12" cy="12" r="5" fill="none" stroke="black" stroke-width="1.5"/>
  <line x1="12" y1="7" x2="12" y2="4" stroke="black" stroke-width="1"/>
  <line x1="17" y1="12" x2="20" y2="12" stroke="black" stroke-width="1"/>
  <line x1="15.5" y1="8.5" x2="17.5" y2="6.5" stroke="black" stroke-width="1"/>
  <line x1="4" y1="86" x2="86" y2="86" stroke="black" stroke-width="1"/>
  <line x1="4" y1="86" x2="4" y2="4" stroke="black" stroke-width="1"/>
</svg>`
      },
      {
        id: 'bidet',
        label: 'Bidet',
        defaultW: 45, defaultH: 70,
        realW_cm: 37, realH_cm: 60,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 70">
  <path d="M6,4 L39,4 Q41,4 41,20 Q41,66 22.5,66 Q4,66 4,20 Q4,4 6,4 Z" fill="white" stroke="black" stroke-width="2"/>
  <ellipse cx="22.5" cy="38" rx="13" ry="22" fill="none" stroke="black" stroke-width="1.5"/>
  <circle cx="22.5" cy="10" r="3" fill="black"/>
  <line x1="16" y1="10" x2="29" y2="10" stroke="black" stroke-width="2"/>
</svg>`
      },
      {
        id: 'lave-linge',
        label: 'Lave-linge',
        defaultW: 80, defaultH: 80,
        realW_cm: 60, realH_cm: 60,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">
  <rect x="3" y="3" width="74" height="74" fill="white" stroke="black" stroke-width="2"/>
  <circle cx="40" cy="42" r="26" fill="none" stroke="black" stroke-width="1.5"/>
  <circle cx="40" cy="42" r="18" fill="none" stroke="black" stroke-width="1"/>
  <rect x="10" y="8" width="28" height="8" rx="2" fill="none" stroke="black" stroke-width="1"/>
  <circle cx="62" cy="12" r="4" fill="none" stroke="black" stroke-width="1.5"/>
</svg>`
      },
      {
        id: 'evier',
        label: 'Évier simple',
        defaultW: 70, defaultH: 55,
        realW_cm: 60, realH_cm: 50,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 70 55">
  <rect x="4" y="4" width="62" height="47" rx="4" fill="white" stroke="black" stroke-width="2"/>
  <rect x="10" y="10" width="50" height="35" rx="4" fill="none" stroke="black" stroke-width="1.5"/>
  <circle cx="35" cy="27.5" r="4" fill="none" stroke="black" stroke-width="1.5"/>
  <circle cx="35" cy="8" r="3" fill="black"/>
  <line x1="28" y1="8" x2="42" y2="8" stroke="black" stroke-width="2"/>
</svg>`
      },
      {
        id: 'chauffe-eau',
        label: 'Chauffe-eau',
        defaultW: 60, defaultH: 60,
        realW_cm: 45, realH_cm: 45,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60">
  <circle cx="30" cy="30" r="26" fill="white" stroke="black" stroke-width="2"/>
  <circle cx="30" cy="30" r="18" fill="none" stroke="black" stroke-width="1.5"/>
  <text x="30" y="35" text-anchor="middle" font-size="10" font-family="sans-serif" fill="black">CE</text>
</svg>`
      }
    ]
  },

  // ── Équipements ───────────────────────────────────────────────
  {
    id: 'equipements',
    label: '🔧 Équipements',
    symbols: [
      {
        id: 'radiateur',
        label: 'Radiateur',
        defaultW: 140, defaultH: 18,
        realW_cm: 140, realH_cm: 18,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 18">
  <rect x="2" y="2" width="136" height="14" fill="white" stroke="black" stroke-width="1.5"/>
  <line x1="22" y1="2" x2="22" y2="16" stroke="black" stroke-width="1"/>
  <line x1="42" y1="2" x2="42" y2="16" stroke="black" stroke-width="1"/>
  <line x1="62" y1="2" x2="62" y2="16" stroke="black" stroke-width="1"/>
  <line x1="82" y1="2" x2="82" y2="16" stroke="black" stroke-width="1"/>
  <line x1="102" y1="2" x2="102" y2="16" stroke="black" stroke-width="1"/>
  <line x1="118" y1="2" x2="118" y2="16" stroke="black" stroke-width="1"/>
</svg>`
      }
    ]
  },

  // ── Formes simples ────────────────────────────────────────────
  {
    id: 'formes',
    label: '⬡ Formes simples',
    symbols: [
      {
        id: 'fleche-simple',
        label: 'Flèche simple',
        defaultW: 100, defaultH: 24,
        realW_cm: null, realH_cm: null,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 24">
  <line x1="4" y1="12" x2="78" y2="12" stroke="black" stroke-width="2.5"/>
  <polygon points="76,4 100,12 76,20" fill="black"/>
</svg>`
      },
      {
        id: 'fleche-droite',
        label: 'Flèche épaisse',
        defaultW: 100, defaultH: 40,
        realW_cm: null, realH_cm: null,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40">
  <polygon points="0,14 70,14 70,4 100,20 70,36 70,26 0,26" fill="white" stroke="black" stroke-width="2"/>
</svg>`
      },
      {
        id: 'fleche-double',
        label: 'Flèche double',
        defaultW: 100, defaultH: 40,
        realW_cm: null, realH_cm: null,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40">
  <polygon points="0,20 30,4 30,14 70,14 70,4 100,20 70,36 70,26 30,26 30,36" fill="white" stroke="black" stroke-width="2"/>
</svg>`
      },
      {
        id: 'triangle',
        label: 'Triangle',
        defaultW: 80, defaultH: 70,
        realW_cm: null, realH_cm: null,
        nativeFabric: { type: 'polygon', points: [{x:40,y:4},{x:76,y:66},{x:4,y:66}] },
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 70">
  <polygon points="40,4 76,66 4,66" fill="white" stroke="black" stroke-width="2"/>
</svg>`
      },
      {
        id: 'losange',
        label: 'Losange',
        defaultW: 80, defaultH: 80,
        realW_cm: null, realH_cm: null,
        nativeFabric: { type: 'polygon', points: [{x:40,y:4},{x:76,y:40},{x:40,y:76},{x:4,y:40}] },
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">
  <polygon points="40,4 76,40 40,76 4,40" fill="white" stroke="black" stroke-width="2"/>
</svg>`
      },
      {
        id: 'hexagone',
        label: 'Hexagone',
        defaultW: 80, defaultH: 80,
        realW_cm: null, realH_cm: null,
        nativeFabric: { type: 'polygon', points: [{x:40,y:4},{x:73,y:22},{x:73,y:58},{x:40,y:76},{x:7,y:58},{x:7,y:22}] },
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">
  <polygon points="40,4 73,22 73,58 40,76 7,58 7,22" fill="white" stroke="black" stroke-width="2"/>
</svg>`
      },
      {
        id: 'croix',
        label: 'Croix',
        defaultW: 60, defaultH: 60,
        realW_cm: null, realH_cm: null,
        nativeFabric: { type: 'polygon', points: [{x:20,y:4},{x:40,y:4},{x:40,y:20},{x:56,y:20},{x:56,y:40},{x:40,y:40},{x:40,y:56},{x:20,y:56},{x:20,y:40},{x:4,y:40},{x:4,y:20},{x:20,y:20}] },
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60">
  <polygon points="20,4 40,4 40,20 56,20 56,40 40,40 40,56 20,56 20,40 4,40 4,20 20,20" fill="white" stroke="black" stroke-width="2"/>
</svg>`
      },
      {
        id: 'ellipse-sym',
        label: 'Ellipse',
        defaultW: 100, defaultH: 60,
        realW_cm: null, realH_cm: null,
        nativeFabric: { type: 'ellipse', rx: 46, ry: 26 },
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">
  <ellipse cx="50" cy="30" rx="46" ry="26" fill="white" stroke="black" stroke-width="2"/>
</svg>`
      },
      {
        id: 'nuage',
        label: 'Nuage révision',
        defaultW: 120, defaultH: 80,
        realW_cm: null, realH_cm: null,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80">
  <path d="M 10 15 A 17 17 0 0 1 43 15 A 17 17 0 0 1 76 15 A 17 17 0 0 1 110 15
           A 13 13 0 0 1 110 40 A 13 13 0 0 1 110 65
           A 17 17 0 0 1 77 65 A 17 17 0 0 1 44 65 A 17 17 0 0 1 10 65
           A 13 13 0 0 1 10 40 A 13 13 0 0 1 10 15 Z"
        fill="white" stroke="black" stroke-width="2"/>
</svg>`
      },
      {
        id: 'ligne-rupture',
        label: 'Ligne de rupture',
        defaultW: 120, defaultH: 20,
        realW_cm: null, realH_cm: null,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 20">
  <polyline points="0,10 40,10 50,3 55,17 60,10 120,10" fill="none" stroke="black" stroke-width="2"/>
</svg>`
      },
      {
        id: 'niveau',
        label: 'Symbole de niveau',
        defaultW: 60, defaultH: 60,
        realW_cm: null, realH_cm: null,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60">
  <polygon points="30,54 6,30 30,6 54,30" fill="white" stroke="black" stroke-width="2"/>
  <line x1="4" y1="30" x2="56" y2="30" stroke="black" stroke-width="1.5"/>
  <text x="30" y="33" text-anchor="middle" font-size="10" font-family="sans-serif" fill="black">±0</text>
</svg>`
      }
    ]
  }
];
