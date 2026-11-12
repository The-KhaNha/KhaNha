export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          actor_role: string | null;
          actor_type: Database['public']['Enums']['actor_type'];
          changes: Json | null;
          entity_id: string;
          entity_type: string;
          id: number;
          occurred_at: string;
          reason: string | null;
          request_id: string | null;
          store_id: string | null;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          actor_role?: string | null;
          actor_type: Database['public']['Enums']['actor_type'];
          changes?: Json | null;
          entity_id: string;
          entity_type: string;
          id?: never;
          occurred_at?: string;
          reason?: string | null;
          request_id?: string | null;
          store_id?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          actor_role?: string | null;
          actor_type?: Database['public']['Enums']['actor_type'];
          changes?: Json | null;
          entity_id?: string;
          entity_type?: string;
          id?: never;
          occurred_at?: string;
          reason?: string | null;
          request_id?: string | null;
          store_id?: string | null;
        };
        Relationships: [];
      };
      brands: {
        Row: {
          created_at: string;
          description: string;
          id: string;
          logo_url: string | null;
          name: string;
          owner_id: string | null;
          slug: string;
          status: Database['public']['Enums']['store_status'];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description?: string;
          id?: string;
          logo_url?: string | null;
          name: string;
          owner_id?: string | null;
          slug: string;
          status?: Database['public']['Enums']['store_status'];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string;
          id?: string;
          logo_url?: string | null;
          name?: string;
          owner_id?: string | null;
          slug?: string;
          status?: Database['public']['Enums']['store_status'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'brands_owner_id_fkey';
            columns: ['owner_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      domain_events: {
        Row: {
          actor: Json | null;
          aggregate_id: string;
          aggregate_type: string;
          id: string;
          occurred_at: string;
          payload: Json;
          request_id: string | null;
          store_id: string | null;
          type: string;
        };
        Insert: {
          actor?: Json | null;
          aggregate_id: string;
          aggregate_type: string;
          id?: string;
          occurred_at?: string;
          payload: Json;
          request_id?: string | null;
          store_id?: string | null;
          type: string;
        };
        Update: {
          actor?: Json | null;
          aggregate_id?: string;
          aggregate_type?: string;
          id?: string;
          occurred_at?: string;
          payload?: Json;
          request_id?: string | null;
          store_id?: string | null;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'domain_events_store_id_fkey';
            columns: ['store_id'];
            isOneToOne: false;
            referencedRelation: 'stores';
            referencedColumns: ['id'];
          },
        ];
      };
      event_subscriptions: {
        Row: {
          event_type: string;
          queue_name: string;
        };
        Insert: {
          event_type: string;
          queue_name: string;
        };
        Update: {
          event_type?: string;
          queue_name?: string;
        };
        Relationships: [];
      };
      feature_flags: {
        Row: {
          client_visible: boolean;
          description: string;
          enabled: boolean;
          key: string;
          rules: Json;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          client_visible?: boolean;
          description: string;
          enabled?: boolean;
          key: string;
          rules?: Json;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          client_visible?: boolean;
          description?: string;
          enabled?: boolean;
          key?: string;
          rules?: Json;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'feature_flags_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      job_failures: {
        Row: {
          attempts: number;
          failed_at: string;
          id: number;
          last_error: string;
          message: Json;
          queue_name: string;
          resolved_at: string | null;
          resolved_by: string | null;
        };
        Insert: {
          attempts: number;
          failed_at?: string;
          id?: never;
          last_error: string;
          message: Json;
          queue_name: string;
          resolved_at?: string | null;
          resolved_by?: string | null;
        };
        Update: {
          attempts?: number;
          failed_at?: string;
          id?: never;
          last_error?: string;
          message?: Json;
          queue_name?: string;
          resolved_at?: string | null;
          resolved_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'job_failures_resolved_by_fkey';
            columns: ['resolved_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      menu_items: {
        Row: {
          category: string;
          description: string;
          id: string;
          image_url: string;
          is_available: boolean;
          is_popular: boolean;
          name: string;
          price_paise: number;
          sort_order: number;
          stock_quantity: number | null;
          store_id: string;
        };
        Insert: {
          category: string;
          description: string;
          id?: string;
          image_url: string;
          is_available?: boolean;
          is_popular?: boolean;
          name: string;
          price_paise: number;
          sort_order?: number;
          stock_quantity?: number | null;
          store_id: string;
        };
        Update: {
          category?: string;
          description?: string;
          id?: string;
          image_url?: string;
          is_available?: boolean;
          is_popular?: boolean;
          name?: string;
          price_paise?: number;
          sort_order?: number;
          stock_quantity?: number | null;
          store_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'menu_items_store_id_fkey';
            columns: ['store_id'];
            isOneToOne: false;
            referencedRelation: 'stores';
            referencedColumns: ['id'];
          },
        ];
      };
      order_items: {
        Row: {
          category: string;
          id: string;
          image_url: string;
          line_number: number;
          line_total_paise: number;
          menu_item_id: string;
          name: string;
          order_id: string;
          quantity: number;
          reserved_quantity: number;
          unit_price_paise: number;
        };
        Insert: {
          category: string;
          id?: string;
          image_url: string;
          line_number: number;
          line_total_paise: number;
          menu_item_id: string;
          name: string;
          order_id: string;
          quantity: number;
          reserved_quantity: number;
          unit_price_paise: number;
        };
        Update: {
          category?: string;
          id?: string;
          image_url?: string;
          line_number?: number;
          line_total_paise?: number;
          menu_item_id?: string;
          name?: string;
          order_id?: string;
          quantity?: number;
          reserved_quantity?: number;
          unit_price_paise?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'order_items_menu_item_id_fkey';
            columns: ['menu_item_id'];
            isOneToOne: false;
            referencedRelation: 'menu_items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_items_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
        ];
      };
      orders: {
        Row: {
          created_at: string;
          customer_name: string;
          customer_phone: string | null;
          estimated_ready_at: string;
          id: string;
          idempotency_key: string | null;
          note: string | null;
          order_number: number;
          payment_status: Database['public']['Enums']['payment_status'];
          status: Database['public']['Enums']['order_status'];
          store_id: string;
          store_name: string;
          total_paise: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          customer_name: string;
          customer_phone?: string | null;
          estimated_ready_at: string;
          id?: string;
          idempotency_key?: string | null;
          note?: string | null;
          order_number?: never;
          payment_status?: Database['public']['Enums']['payment_status'];
          status?: Database['public']['Enums']['order_status'];
          store_id: string;
          store_name: string;
          total_paise: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          customer_name?: string;
          customer_phone?: string | null;
          estimated_ready_at?: string;
          id?: string;
          idempotency_key?: string | null;
          note?: string | null;
          order_number?: never;
          payment_status?: Database['public']['Enums']['payment_status'];
          status?: Database['public']['Enums']['order_status'];
          store_id?: string;
          store_name?: string;
          total_paise?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'orders_store_id_fkey';
            columns: ['store_id'];
            isOneToOne: false;
            referencedRelation: 'stores';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          name: string;
          phone: string | null;
          role: Database['public']['Enums']['user_role'];
        };
        Insert: {
          created_at?: string;
          email: string;
          id: string;
          name: string;
          phone?: string | null;
          role?: Database['public']['Enums']['user_role'];
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          name?: string;
          phone?: string | null;
          role?: Database['public']['Enums']['user_role'];
        };
        Relationships: [];
      };
      session_activity: {
        Row: {
          last_seen_at: string;
          session_id: string;
          user_id: string;
        };
        Insert: {
          last_seen_at: string;
          session_id: string;
          user_id: string;
        };
        Update: {
          last_seen_at?: string;
          session_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'session_activity_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      site_settings: {
        Row: {
          client_error_sample_percent: number;
          customer_order_history_limit: number;
          id: boolean;
          max_lines_per_order: number;
          min_client_version: string;
          order_poll_ms: number;
          orders_poll_ms: number;
          staff_board_poll_ms: number;
          staff_order_list_limit: number;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          client_error_sample_percent?: number;
          customer_order_history_limit?: number;
          id?: boolean;
          max_lines_per_order?: number;
          min_client_version?: string;
          order_poll_ms?: number;
          orders_poll_ms?: number;
          staff_board_poll_ms?: number;
          staff_order_list_limit?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          client_error_sample_percent?: number;
          customer_order_history_limit?: number;
          id?: boolean;
          max_lines_per_order?: number;
          min_client_version?: string;
          order_poll_ms?: number;
          orders_poll_ms?: number;
          staff_board_poll_ms?: number;
          staff_order_list_limit?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'site_settings_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      store_hours: {
        Row: {
          closes_at: string;
          created_at: string;
          day_of_week: number;
          id: string;
          opens_at: string;
          store_id: string;
        };
        Insert: {
          closes_at: string;
          created_at?: string;
          day_of_week: number;
          id?: string;
          opens_at: string;
          store_id: string;
        };
        Update: {
          closes_at?: string;
          created_at?: string;
          day_of_week?: number;
          id?: string;
          opens_at?: string;
          store_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'store_hours_store_id_fkey';
            columns: ['store_id'];
            isOneToOne: false;
            referencedRelation: 'stores';
            referencedColumns: ['id'];
          },
        ];
      };
      store_invites: {
        Row: {
          accepted_at: string | null;
          accepted_by: string | null;
          created_at: string;
          created_by: string | null;
          email: string;
          expires_at: string;
          id: string;
          revoked_at: string | null;
          role: Database['public']['Enums']['store_role'];
          store_id: string;
          token_hash: string;
        };
        Insert: {
          accepted_at?: string | null;
          accepted_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          email: string;
          expires_at: string;
          id?: string;
          revoked_at?: string | null;
          role: Database['public']['Enums']['store_role'];
          store_id: string;
          token_hash: string;
        };
        Update: {
          accepted_at?: string | null;
          accepted_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          email?: string;
          expires_at?: string;
          id?: string;
          revoked_at?: string | null;
          role?: Database['public']['Enums']['store_role'];
          store_id?: string;
          token_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'store_invites_accepted_by_fkey';
            columns: ['accepted_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'store_invites_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'store_invites_store_id_fkey';
            columns: ['store_id'];
            isOneToOne: false;
            referencedRelation: 'stores';
            referencedColumns: ['id'];
          },
        ];
      };
      store_memberships: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          role: Database['public']['Enums']['store_role'];
          store_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          role: Database['public']['Enums']['store_role'];
          store_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          role?: Database['public']['Enums']['store_role'];
          store_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'store_memberships_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'store_memberships_store_id_fkey';
            columns: ['store_id'];
            isOneToOne: false;
            referencedRelation: 'stores';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'store_memberships_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      store_schedule_exceptions: {
        Row: {
          closes_at: string | null;
          created_at: string;
          ends_on: string;
          id: string;
          kind: Database['public']['Enums']['schedule_exception_kind'];
          label: string;
          opens_at: string | null;
          starts_on: string;
          store_id: string;
        };
        Insert: {
          closes_at?: string | null;
          created_at?: string;
          ends_on: string;
          id?: string;
          kind: Database['public']['Enums']['schedule_exception_kind'];
          label: string;
          opens_at?: string | null;
          starts_on: string;
          store_id: string;
        };
        Update: {
          closes_at?: string | null;
          created_at?: string;
          ends_on?: string;
          id?: string;
          kind?: Database['public']['Enums']['schedule_exception_kind'];
          label?: string;
          opens_at?: string | null;
          starts_on?: string;
          store_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'store_schedule_exceptions_store_id_fkey';
            columns: ['store_id'];
            isOneToOne: false;
            referencedRelation: 'stores';
            referencedColumns: ['id'];
          },
        ];
      };
      stores: {
        Row: {
          address_line: string | null;
          area: string | null;
          brand_id: string;
          contact_phone: string | null;
          created_at: string;
          description: string;
          id: string;
          image_url: string | null;
          is_open: boolean;
          last_order_minutes_before_close: number;
          low_stock_threshold: number;
          max_quantity_per_item: number;
          name: string;
          prep_time_max_minutes: number;
          prep_time_min_minutes: number;
          slug: string;
          staff_order_list_limit: number;
          status: Database['public']['Enums']['store_status'];
          tagline: string;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          address_line?: string | null;
          area?: string | null;
          brand_id: string;
          contact_phone?: string | null;
          created_at?: string;
          description: string;
          id?: string;
          image_url?: string | null;
          is_open?: boolean;
          last_order_minutes_before_close?: number;
          low_stock_threshold?: number;
          max_quantity_per_item?: number;
          name: string;
          prep_time_max_minutes?: number;
          prep_time_min_minutes?: number;
          slug: string;
          staff_order_list_limit?: number;
          status?: Database['public']['Enums']['store_status'];
          tagline: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          address_line?: string | null;
          area?: string | null;
          brand_id?: string;
          contact_phone?: string | null;
          created_at?: string;
          description?: string;
          id?: string;
          image_url?: string | null;
          is_open?: boolean;
          last_order_minutes_before_close?: number;
          low_stock_threshold?: number;
          max_quantity_per_item?: number;
          name?: string;
          prep_time_max_minutes?: number;
          prep_time_min_minutes?: number;
          slug?: string;
          staff_order_list_limit?: number;
          status?: Database['public']['Enums']['store_status'];
          tagline?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'stores_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      emit_event: {
        Args: {
          p_actor: Json;
          p_aggregate_id: string;
          p_aggregate_type: string;
          p_payload: Json;
          p_request_id: string;
          p_store_id: string;
          p_type: string;
        };
        Returns: string;
      };
      place_order: {
        Args: {
          p_actor?: Json;
          p_customer_name: string;
          p_customer_phone?: string;
          p_idempotency_key?: string;
          p_lines: Json;
          p_note?: string;
          p_payment_status: Database['public']['Enums']['payment_status'];
          p_request_id?: string;
          p_store_id: string;
          p_user_id: string;
        };
        Returns: string;
      };
      profile_name: {
        Args: { p_email: string; p_name: string };
        Returns: string;
      };
      profile_phone: { Args: { p_phone: string }; Returns: string };
      purge_domain_events: {
        Args: { p_keep?: string; p_now?: string };
        Returns: number;
      };
      purge_session_activity: { Args: never; Returns: number };
      queue_dead_letter: {
        Args: {
          p_attempts: number;
          p_error: string;
          p_message: Json;
          p_msg_id: number;
          p_queue: string;
        };
        Returns: boolean;
      };
      queue_delete: {
        Args: { p_msg_id: number; p_queue: string };
        Returns: boolean;
      };
      queue_metrics: {
        Args: { p_queue: string };
        Returns: {
          oldest_msg_age_sec: number;
          queue_length: number;
        }[];
      };
      queue_read: {
        Args: {
          p_poll_seconds: number;
          p_qty: number;
          p_queue: string;
          p_vt_seconds: number;
        };
        Returns: {
          enqueued_at: string;
          message: Json;
          msg_id: number;
          read_ct: number;
        }[];
      };
      queue_retry: {
        Args: { p_delay_seconds: number; p_msg_id: number; p_queue: string };
        Returns: undefined;
      };
      reset_demo_orders: { Args: never; Returns: undefined };
      touch_session: {
        Args: {
          p_idle: string;
          p_now?: string;
          p_session_id: string;
          p_user_id: string;
        };
        Returns: boolean;
      };
      update_order_status: {
        Args: {
          p_actor?: Json;
          p_from_statuses: Database['public']['Enums']['order_status'][];
          p_next_status: Database['public']['Enums']['order_status'];
          p_order_id: string;
          p_request_id?: string;
        };
        Returns: boolean;
      };
    };
    Enums: {
      actor_type: 'USER' | 'WORKER' | 'RECONCILER' | 'WEBHOOK' | 'SCHEDULER' | 'SYSTEM';
      order_status: 'PLACED' | 'PREPARING' | 'READY' | 'COLLECTED' | 'CANCELLED';
      payment_status: 'PENDING' | 'PAID';
      schedule_exception_kind: 'CLOSED' | 'SPECIAL_HOURS';
      store_role: 'MANAGER' | 'STAFF';
      store_status: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
      user_role: 'CUSTOMER' | 'STAFF' | 'ADMIN';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      actor_type: ['USER', 'WORKER', 'RECONCILER', 'WEBHOOK', 'SCHEDULER', 'SYSTEM'],
      order_status: ['PLACED', 'PREPARING', 'READY', 'COLLECTED', 'CANCELLED'],
      payment_status: ['PENDING', 'PAID'],
      schedule_exception_kind: ['CLOSED', 'SPECIAL_HOURS'],
      store_role: ['MANAGER', 'STAFF'],
      store_status: ['DRAFT', 'ACTIVE', 'SUSPENDED', 'ARCHIVED'],
      user_role: ['CUSTOMER', 'STAFF', 'ADMIN'],
    },
  },
} as const;
