// Follows the system theme by default (TRD §15.6). A manual choice in Settings comes with the settings tickets.
try {
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.classList.add('dark');
  }
} catch {
  // keep the light theme
}
