import { useCallback, useState, type ReactNode } from 'react';
import type { MenuItem, MenuResponse } from '../../types/api';
import { cartHoldsOtherStore } from '../stores/storeRules';
import { useCartStore, type CartOption, type CartStoreRef } from './cartStore';
import { ReplaceCartSheet } from './ReplaceCartSheet';
import { AddToCartContext, type AddToCart } from './useAddToCart';

interface AddToCartProviderProps {
  store: CartStoreRef;
  /** The store's limits: they replace the old cart's the moment the cart switches. */
  rules: MenuResponse['rules'];
  children: ReactNode;
}

/**
 * The column of one store's menu (a plain div). Everything under it adds through `useAddToCart`, which asks before a cart that holds
 * another store's items is replaced (the sheet is rendered here, once, whichever card was tapped).
 */
export function AddToCartProvider({ store, rules, children }: AddToCartProviderProps) {
  const [pending, setPending] = useState<{
    item: MenuItem;
    quantity: number;
    options: CartOption[];
  } | null>(null);
  const fromName = useCartStore((s) => s.storeName);

  const addToCart = useCallback<AddToCart>(
    (item, quantity = 1, options = []) => {
      const cart = useCartStore.getState();
      if (cartHoldsOtherStore(cart, store.id)) {
        setPending({ item, quantity, options });
        return false;
      }
      cart.add(item, quantity, store, options);
      return true;
    },
    [store],
  );

  const replace = useCallback(() => {
    if (!pending) return;
    const cart = useCartStore.getState();
    cart.clear();
    cart.setLimits(rules);
    cart.add(pending.item, pending.quantity, store, pending.options);
    setPending(null);
  }, [pending, rules, store]);
  const keep = useCallback(() => setPending(null), []);

  return (
    <AddToCartContext.Provider value={addToCart}>
      <div>{children}</div>
      {pending && (
        <ReplaceCartSheet
          fromName={fromName ?? 'another store'}
          toName={store.name}
          onReplace={replace}
          onKeep={keep}
        />
      )}
    </AddToCartContext.Provider>
  );
}
