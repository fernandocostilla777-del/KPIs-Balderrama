tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'primary-container': '#0f172a', tertiary: '#ffafd3', error: '#ffb4ab', outline: '#909097',
        'surface-bright': '#2c3a4c', 'surface-container-highest': '#273647', 'on-secondary': '#00354a',
        'surface-dim': '#051424', 'surface-container-low': '#0d1c2d', primary: '#bec6e0',
        surface: '#051424', secondary: '#7bd0ff', 'surface-variant': '#273647',
        'surface-container': '#122131', 'on-background': '#d4e4fa', background: '#051424',
        'surface-container-high': '#1c2b3c', 'outline-variant': '#45464d', 'on-surface-variant': '#c6c6cd',
        'secondary-container': '#00a6e0', 'on-surface': '#d4e4fa', 'error-container': '#93000a',
        'on-error-container': '#ffdad6', 'tertiary-fixed-dim': '#ffafd3',
      },
      borderRadius: { DEFAULT: '0.125rem', lg: '0.25rem', xl: '0.5rem', full: '0.75rem' },
      spacing: { xs: '0.25rem', sm: '0.5rem', md: '1rem', lg: '1.5rem', xl: '2.5rem', 'sidebar-width': '260px', gutter: '1.5rem' },
      fontFamily: { 'label-md': ['JetBrains Mono'], 'label-sm': ['JetBrains Mono'], 'headline-lg': ['Inter'], 'headline-md': ['Inter'], 'body-sm': ['Inter'] },
      fontSize: {
        'label-md': ['12px', { lineHeight: '16px', letterSpacing: '0.05em', fontWeight: '500' }],
        'label-sm': ['10px', { lineHeight: '14px', letterSpacing: '0.08em', fontWeight: '500' }],
        'headline-lg': ['32px', { lineHeight: '40px', fontWeight: '600' }],
        'headline-md': ['24px', { lineHeight: '32px', fontWeight: '600' }],
        'body-sm': ['14px', { lineHeight: '20px', fontWeight: '400' }],
      },
    },
  },
};
