import { createContext, useContext } from 'react';
import type { MenuItem } from '../../types/api';
import { useCartStore } from './cartStore';

/** Adds to the cart; false when the customer is being asked first (see AddToCartProvider). */
export type AddToCart = (item: MenuItem, quantity?: number) => boolean;

export const AddToCartContext = createContext<AddToCart | null>(null);

const addWithoutStore: AddToCart = (item, quantity = 1) => {
  useCartStore.getState().add(item, quantity);
  return true;
};

/** The add function of the menu this component sits in. Outside an AddToCartProvider it adds with no store. */
export function useAddToCart(): AddToCart {
  return useContext(AddToCartContext) ?? addWithoutStore;
}
