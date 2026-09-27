import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FoodPhoto } from './FoodPhoto';

describe('FoodPhoto', () => {
  it('gives a bundled photo its srcSet and the passed sizes', () => {
    render(<FoodPhoto src="/images/espresso.jpg" alt="Espresso" sizes="188px" />);
    const img = screen.getByAltText('Espresso');
    expect(img).toHaveAttribute(
      'srcset',
      '/images/espresso-400.jpg 400w, /images/espresso.jpg 900w',
    );
    expect(img).toHaveAttribute('sizes', '188px');
  });

  it('defaults sizes to 112px when the caller does not pass one', () => {
    render(<FoodPhoto src="/images/espresso.jpg" alt="Espresso" />);
    expect(screen.getByAltText('Espresso')).toHaveAttribute('sizes', '112px');
  });

  it('renders no srcSet for a URL with no bundled variants', () => {
    const url = 'https://abc.supabase.co/storage/v1/object/public/x.jpg';
    render(<FoodPhoto src={url} alt="Uploaded" />);
    const img = screen.getByAltText('Uploaded');
    expect(img).not.toHaveAttribute('srcset');
    expect(img).toHaveAttribute('src', url);
  });

  it('renders no <img> at all when src is null', () => {
    const { container } = render(<FoodPhoto src={null} alt="Missing" />);
    expect(container.querySelector('img')).toBeNull();
  });
});
