export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          operationName?: string
          query?: string
          variables?: Json
          extensions?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      auth_credentials: {
        Row: {
          id: string
          password_hash: string
          role: string
          display_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          id?: string
          password_hash: string
          role: string
          display_name?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          id?: string
          password_hash?: string
          role?: string
          display_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      staff_notifications: {
        Row: {
          id: string
          cafe_id: string
          action: string
          description: string
          created_by: string
          is_read: boolean
          created_at: string
        }
        Insert: {
          id?: string
          cafe_id: string
          action: string
          description: string
          created_by: string
          is_read?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          cafe_id?: string
          action?: string
          description?: string
          created_by?: string
          is_read?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'staff_notifications_cafe_id_fkey'
            columns: ['cafe_id']
            isOneToOne: false
            referencedRelation: 'cafes'
            referencedColumns: ['id']
          }
        ]
      }
      cafes: {
        Row: {
          address: string | null
          created_at: string
          currency: string
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          phone: string | null
          settings: Json
          slug: string
          timezone: string
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          phone?: string | null
          settings?: Json
          slug: string
          timezone?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          phone?: string | null
          settings?: Json
          slug?: string
          timezone?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: []
      }
      customers: {
        Row: {
          cafe_id: string
          created_at: string
          id: string
          last_visit_at: string | null
          name: string | null
          phone: string
          tags: string[] | null
          total_orders: number
          total_spent: number
          whatsapp: string | null
        }
        Insert: {
          cafe_id: string
          created_at?: string
          id?: string
          last_visit_at?: string | null
          name?: string | null
          phone: string
          tags?: string[] | null
          total_orders?: number
          total_spent?: number
          whatsapp?: string | null
        }
        Update: {
          cafe_id?: string
          created_at?: string
          id?: string
          last_visit_at?: string | null
          name?: string | null
          phone?: string
          tags?: string[] | null
          total_orders?: number
          total_spent?: number
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_cafe_id_fkey"
            columns: ["cafe_id"]
            isOneToOne: false
            referencedRelation: "cafes"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredients: {
        Row: {
          cost_per_unit_paisa: number
          created_at: string
          current_stock: number
          expiry_date: string | null
          id: string
          is_perishable: boolean
          low_stock_threshold: number
          name: string
          unit: string
          updated_at: string
        }
        Insert: {
          cost_per_unit_paisa?: number
          created_at?: string
          current_stock?: number
          expiry_date?: string | null
          id?: string
          is_perishable?: boolean
          low_stock_threshold?: number
          name: string
          unit: string
          updated_at?: string
        }
        Update: {
          cost_per_unit_paisa?: number
          created_at?: string
          current_stock?: number
          expiry_date?: string | null
          id?: string
          is_perishable?: boolean
          low_stock_threshold?: number
          name?: string
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      kot_tickets: {
        Row: {
          id: string
          items_json: Json
          order_id: string
          print_status: string
          printed_at: string
          station: string
        }
        Insert: {
          id?: string
          items_json: Json
          order_id: string
          print_status?: string
          printed_at?: string
          station: string
        }
        Update: {
          id?: string
          items_json?: Json
          order_id?: string
          print_status?: string
          printed_at?: string
          station?: string
        }
        Relationships: [
          {
            foreignKeyName: "kot_tickets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_categories: {
        Row: {
          cafe_id: string
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          name_hi: string | null
          sort_order: number
        }
        Insert: {
          cafe_id: string
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          name_hi?: string | null
          sort_order?: number
        }
        Update: {
          cafe_id?: string
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          name_hi?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_categories_cafe_id_fkey"
            columns: ["cafe_id"]
            isOneToOne: false
            referencedRelation: "cafes"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          cafe_id: string
          category: Database["public"]["Enums"]["menu_item_category"]
          category_id: string
          contains_gluten: boolean
          contains_nuts: boolean
          cost_price_paisa: number
          created_at: string
          description: string | null
          description_hi: string | null
          id: string
          image_url: string | null
          is_available: boolean
          is_featured: boolean
          is_jain: boolean
          is_veg: boolean
          is_vegan: boolean
          name: string
          name_hi: string | null
          order_count: number
          prep_time_mins: number
          price: number
          sort_order: number
          spice_level: number | null
          updated_at: string
          upsell_item_ids: string[] | null
        }
        Insert: {
          cafe_id: string
          category?: Database["public"]["Enums"]["menu_item_category"]
          category_id: string
          contains_gluten?: boolean
          contains_nuts?: boolean
          cost_price_paisa?: number
          created_at?: string
          description?: string | null
          description_hi?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean
          is_featured?: boolean
          is_jain?: boolean
          is_veg?: boolean
          is_vegan?: boolean
          name: string
          name_hi?: string | null
          order_count?: number
          prep_time_mins?: number
          price: number
          sort_order?: number
          spice_level?: number | null
          updated_at?: string
          upsell_item_ids?: string[] | null
        }
        Update: {
          cafe_id?: string
          category?: Database["public"]["Enums"]["menu_item_category"]
          category_id?: string
          contains_gluten?: boolean
          contains_nuts?: boolean
          cost_price_paisa?: number
          created_at?: string
          description?: string | null
          description_hi?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean
          is_featured?: boolean
          is_jain?: boolean
          is_veg?: boolean
          is_vegan?: boolean
          name?: string
          name_hi?: string | null
          order_count?: number
          prep_time_mins?: number
          price?: number
          sort_order?: number
          spice_level?: number | null
          updated_at?: string
          upsell_item_ids?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_cafe_id_fkey"
            columns: ["cafe_id"]
            isOneToOne: false
            referencedRelation: "cafes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          category: Database["public"]["Enums"]["menu_item_category"] | null
          created_at: string
          customisation: string | null
          id: string
          menu_item_id: string
          name: string
          order_id: string
          price: number
          quantity: number
          status: string
          subtotal: number
        }
        Insert: {
          category?: Database["public"]["Enums"]["menu_item_category"] | null
          created_at?: string
          customisation?: string | null
          id?: string
          menu_item_id: string
          name: string
          order_id: string
          price: number
          quantity?: number
          status?: string
          subtotal: number
        }
        Update: {
          category?: Database["public"]["Enums"]["menu_item_category"] | null
          created_at?: string
          customisation?: string | null
          id?: string
          menu_item_id?: string
          name?: string
          order_id?: string
          price?: number
          quantity?: number
          status?: string
          subtotal?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          billed_at: string | null
          cafe_id: string
          completed_at: string | null
          confirmed_at: string | null
          created_at: string
          customer_id: string | null
          discount_amount: number
          estimated_mins: number | null
          id: string
          kot_sent_at: string | null
          notes: string | null
          order_number: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          pos_status: string
          razorpay_order_id: string | null
          razorpay_payment_id: string | null
          ready_at: string | null
          served_at: string | null
          service_charge: number
          status: Database["public"]["Enums"]["order_status"]
          stock_deducted_at: string | null
          subtotal: number
          table_id: string
          tax_amount: number
          total_amount: number
          total_paisa: number
          updated_at: string
        }
        Insert: {
          billed_at?: string | null
          cafe_id: string
          completed_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          customer_id?: string | null
          discount_amount?: number
          estimated_mins?: number | null
          id?: string
          kot_sent_at?: string | null
          notes?: string | null
          order_number: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_status?: Database["public"]["Enums"]["payment_status"]
          pos_status?: string
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          ready_at?: string | null
          served_at?: string | null
          service_charge?: number
          status?: Database["public"]["Enums"]["order_status"]
          stock_deducted_at?: string | null
          subtotal?: number
          table_id: string
          tax_amount?: number
          total_amount?: number
          total_paisa?: number
          updated_at?: string
        }
        Update: {
          billed_at?: string | null
          cafe_id?: string
          completed_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          customer_id?: string | null
          discount_amount?: number
          estimated_mins?: number | null
          id?: string
          kot_sent_at?: string | null
          notes?: string | null
          order_number?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_status?: Database["public"]["Enums"]["payment_status"]
          pos_status?: string
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          ready_at?: string | null
          served_at?: string | null
          service_charge?: number
          status?: Database["public"]["Enums"]["order_status"]
          stock_deducted_at?: string | null
          subtotal?: number
          table_id?: string
          tax_amount?: number
          total_amount?: number
          total_paisa?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_cafe_id_fkey"
            columns: ["cafe_id"]
            isOneToOne: false
            referencedRelation: "cafes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_paisa: number
          approval_code: string | null
          client_id: string | null
          created_at: string
          id: string
          mode: string | null
          order_id: string
          plutus_ptrid: string | null
          raw_response: Json | null
          rrn: string | null
          status: string
          store_id: string | null
          transaction_number: string
          txn_log_id: string | null
        }
        Insert: {
          amount_paisa: number
          approval_code?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          mode?: string | null
          order_id: string
          plutus_ptrid?: string | null
          raw_response?: Json | null
          rrn?: string | null
          status?: string
          store_id?: string | null
          transaction_number: string
          txn_log_id?: string | null
        }
        Update: {
          amount_paisa?: number
          approval_code?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          mode?: string | null
          order_id?: string
          plutus_ptrid?: string | null
          raw_response?: Json | null
          rrn?: string | null
          status?: string
          store_id?: string | null
          transaction_number?: string
          txn_log_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_ingredients: {
        Row: {
          id: string
          ingredient_id: string
          quantity: number
          recipe_id: string
        }
        Insert: {
          id?: string
          ingredient_id: string
          quantity: number
          recipe_id: string
        }
        Update: {
          id?: string
          ingredient_id?: string
          quantity?: number
          recipe_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_ingredients_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_ingredients_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          created_at: string
          id: string
          menu_item_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          menu_item_id: string
        }
        Update: {
          created_at?: string
          id?: string
          menu_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipes_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: true
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      sections: {
        Row: {
          id: number
          name: string
          sort_order: number
        }
        Insert: {
          id: number
          name: string
          sort_order?: number
        }
        Update: {
          id?: number
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      stock_transactions: {
        Row: {
          created_at: string
          id: string
          ingredient_id: string
          note: string | null
          quantity: number
          reference_order_id: string | null
          type: Database["public"]["Enums"]["stock_txn_type"]
        }
        Insert: {
          created_at?: string
          id?: string
          ingredient_id: string
          note?: string | null
          quantity: number
          reference_order_id?: string | null
          type: Database["public"]["Enums"]["stock_txn_type"]
        }
        Update: {
          created_at?: string
          id?: string
          ingredient_id?: string
          note?: string | null
          quantity?: number
          reference_order_id?: string | null
          type?: Database["public"]["Enums"]["stock_txn_type"]
        }
        Relationships: [
          {
            foreignKeyName: "stock_transactions_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transactions_reference_order_id_fkey"
            columns: ["reference_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      tables: {
        Row: {
          cafe_id: string
          capacity: number
          created_at: string
          id: string
          is_active: boolean
          label: string | null
          number: number
          qr_code_url: string | null
          section_id: number | null
          shape: string
          status: Database["public"]["Enums"]["table_status"]
        }
        Insert: {
          cafe_id: string
          capacity?: number
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
          number: number
          qr_code_url?: string | null
          section_id?: number | null
          shape?: string
          status?: Database["public"]["Enums"]["table_status"]
        }
        Update: {
          cafe_id?: string
          capacity?: number
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
          number?: number
          qr_code_url?: string | null
          section_id?: number | null
          shape?: string
          status?: Database["public"]["Enums"]["table_status"]
        }
        Relationships: [
          {
            foreignKeyName: "tables_cafe_id_fkey"
            columns: ["cafe_id"]
            isOneToOne: false
            referencedRelation: "cafes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tables_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
        ]
      }
      terminals: {
        Row: {
          client_id: string
          created_at: string
          id: string
          label: string
          section_id: number | null
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          label: string
          section_id?: number | null
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          label?: string
          section_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "terminals_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      generate_order_number: {
        Args: {
          cafe_id: string
        }
        Returns: string
      }
      recompute_menu_item_cost: {
        Args: {
          p_menu_item_id: string
        }
        Returns: number
      }
      recompute_menu_items_for_ingredient: {
        Args: {
          p_ingredient_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      menu_item_category: "food" | "beverage"
      order_status:
        | "pending"
        | "confirmed"
        | "making"
        | "ready"
        | "served"
        | "cancelled"
        | "completed"
      payment_method: "upi" | "card" | "cash" | "unpaid"
      payment_status: "pending" | "paid" | "failed" | "refunded"
      stock_txn_type:
        | "purchase"
        | "sale_deduction"
        | "manual_adjustment"
        | "expired_removal"
      table_status: "free" | "occupied" | "kot_sent" | "billed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof PublicSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof PublicSchema["CompositeTypes"]
    ? PublicSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

