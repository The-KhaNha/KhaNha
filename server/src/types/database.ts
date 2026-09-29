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
      menu_items: {
        Row: {
          category: string;
          description: string;
          id: string;
          image_url: string;
          is_available: boolean;
          is_popular: boolean;
          name: string;
          price: number;
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
          price: number;
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
          price?: number;
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
          id: string;
          line_number: number;
          line_total: number;
          menu_item_id: string;
          name: string;
          order_id: string;
          quantity: number;
          unit_price: number;
        };
        Insert: {
          id?: string;
          line_number: number;
          line_total: number;
          menu_item_id: string;
          name: string;
          order_id: string;
          quantity: number;
          unit_price: number;
        };
        Update: {
          id?: string;
          line_number?: number;
          line_total?: number;
          menu_item_id?: string;
          name?: string;
          order_id?: string;
          quantity?: number;
          unit_price?: number;
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
          total: number;
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
          total: number;
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
          total?: number;
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
      site_settings: {
        Row: {
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
      stores: {
        Row: {
          description: string;
          id: string;
          image_url: string | null;
          is_open: boolean;
          name: string;
          prep_time_max_minutes: number;
          prep_time_min_minutes: number;
          tagline: string;
        };
        Insert: {
          description: string;
          id?: string;
          image_url?: string | null;
          is_open?: boolean;
          name: string;
          prep_time_max_minutes?: number;
          prep_time_min_minutes?: number;
          tagline: string;
        };
        Update: {
          description?: string;
          id?: string;
          image_url?: string | null;
          is_open?: boolean;
          name?: string;
          prep_time_max_minutes?: number;
          prep_time_min_minutes?: number;
          tagline?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      place_order: {
        Args: {
          p_customer_name: string;
          p_customer_phone?: string;
          p_idempotency_key?: string;
          p_lines: Json;
          p_note?: string;
          p_payment_status: Database['public']['Enums']['payment_status'];
          p_store_id: string;
          p_user_id: string;
        };
        Returns: string;
      };
      reset_demo_orders: { Args: never; Returns: undefined };
      update_order_status: {
        Args: {
          p_from_statuses: Database['public']['Enums']['order_status'][];
          p_next_status: Database['public']['Enums']['order_status'];
          p_order_id: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      order_status: 'PLACED' | 'PREPARING' | 'READY' | 'COLLECTED' | 'CANCELLED';
      payment_status: 'PENDING' | 'PAID';
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
      order_status: ['PLACED', 'PREPARING', 'READY', 'COLLECTED', 'CANCELLED'],
      payment_status: ['PENDING', 'PAID'],
      user_role: ['CUSTOMER', 'STAFF', 'ADMIN'],
    },
  },
} as const;
