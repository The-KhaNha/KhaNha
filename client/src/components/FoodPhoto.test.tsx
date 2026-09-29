import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FoodPhoto, FoodPhotoGate } from './FoodPhoto';

describe('FoodPhotoGate', () => {
  it('holds every photo inside: the box renders, the image does not download yet', () => {
    const { container, rerender } = render(
      <FoodPhotoGate held>
        <FoodPhoto src="/images/espresso.jpg" alt="Espresso" className="h-28 w-28" />
      </FoodPhotoGate>,
    );
    expect(container.querySelector('[data-food-photo]')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();

    rerender(
      <FoodPhotoGate held={false}>
        <FoodPhoto src="/images/espresso.jpg" alt="Espresso" className="h-28 w-28" />
      </FoodPhotoGate>,
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/images/espresso.jpg');
  });

  it('never holds a photo outside a gate', () => {
    const { container } = render(<FoodPhoto src="/images/espresso.jpg" alt="Espresso" />);
    expect(container.querySelector('img')).not.toBeNull();
  });
});
