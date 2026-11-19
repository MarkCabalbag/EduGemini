import { useEffect } from 'react';

/**
 * Puts the page on the Marked Script paper while the calling page is open: the `paper-page` class on <body> (index.css)
 * turns the whole window, header included, into the ruled sheet and re-points the shared tokens to its inks.
 */
export function usePaperPage() {
  useEffect(() => {
    document.body.classList.add('paper-page');
    return () => document.body.classList.remove('paper-page');
  }, []);
}
