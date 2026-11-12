import { createContext, useContext } from 'react';
import type { MenuItem } from '../../types/api';

/** Adds to the cart; false when the customer is being asked first (see AddToCartProvider). */
export type AddToCart = (item: MenuItem, quantity?: number) => boolean;

export const AddToCartContext = createContext<AddToCart | null>(null);

// A line needs its store (an order without one is refused), so outside a store's menu nothing is added.
const addNothing: AddToCart = () => false;

/** The add function of the menu this component sits in. Outside an AddToCartProvider it adds nothing. */
export function useAddToCart(): AddToCart {
  return useContext(AddToCartContext) ?? addNothing;
}
