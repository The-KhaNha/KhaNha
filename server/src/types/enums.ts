// The Postgres enums from supabase/migrations, as TypeScript types and runtime lists.
import { Constants, type Database } from './database';

type Enums = Database['public']['Enums'];

export type Role = Enums['user_role'];
export type OrderStatus = Enums['order_status'];
export type PaymentStatus = Enums['payment_status'];
export type ActorType = Enums['actor_type'];

export const ORDER_STATUSES = Constants.public.Enums.order_status;
