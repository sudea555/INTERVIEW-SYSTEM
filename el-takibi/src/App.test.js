import { render, screen } from '@testing-library/react';
import App from './App';

test('canlılık testi başlığını gösterir', () => {
  render(<App />);
  const heading = screen.getByText(/canlılık testi/i);
  expect(heading).toBeInTheDocument();
});
