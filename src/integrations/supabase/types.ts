export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      crypto_trades: {
        Row: {
          capital_usd: number
          closed_at: string | null
          created_at: string
          entry_price_usd: number
          exit_price_usd: number | null
          id: string
          pnl_pct: number | null
          pnl_usd: number | null
          signal: string
          status: string
          stop_price_usd: number
          target_price_usd: number
          ticker: string
          user_id: string
        }
        Insert: {
          capital_usd?: number
          closed_at?: string | null
          created_at?: string
          entry_price_usd: number
          exit_price_usd?: number | null
          id?: string
          pnl_pct?: number | null
          pnl_usd?: number | null
          signal: string
          status?: string
          stop_price_usd: number
          target_price_usd: number
          ticker: string
          user_id: string
        }
        Update: {
          capital_usd?: number
          closed_at?: string | null
          created_at?: string
          entry_price_usd?: number
          exit_price_usd?: number | null
          id?: string
          pnl_pct?: number | null
          pnl_usd?: number | null
          signal?: string
          status?: string
          stop_price_usd?: number
          target_price_usd?: number
          ticker?: string
          user_id?: string
        }
        Relationships: []
      }
      portfolio_assets: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          pct_allocation: number
          sl_pct: number
          ticker: string
          tipo: string | null
          tp_pct: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          pct_allocation: number
          sl_pct: number
          ticker: string
          tipo?: string | null
          tp_pct: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          pct_allocation?: number
          sl_pct?: number
          ticker?: string
          tipo?: string | null
          tp_pct?: number
          user_id?: string
        }
        Relationships: []
      }
      positions: {
        Row: {
          ccl_at_entry: number | null
          entry_date: string
          entry_price_ars: number | null
          entry_price_usd: number
          exit_date: string | null
          exit_price_usd: number | null
          id: string
          mep_at_entry: number | null
          pnl_pct: number | null
          pnl_usd: number | null
          quantity: number
          status: string
          ticker: string
          user_id: string
        }
        Insert: {
          ccl_at_entry?: number | null
          entry_date?: string
          entry_price_ars?: number | null
          entry_price_usd: number
          exit_date?: string | null
          exit_price_usd?: number | null
          id?: string
          mep_at_entry?: number | null
          pnl_pct?: number | null
          pnl_usd?: number | null
          quantity?: number
          status?: string
          ticker: string
          user_id: string
        }
        Update: {
          ccl_at_entry?: number | null
          entry_date?: string
          entry_price_ars?: number | null
          entry_price_usd?: number
          exit_date?: string | null
          exit_price_usd?: number | null
          id?: string
          mep_at_entry?: number | null
          pnl_pct?: number | null
          pnl_usd?: number | null
          quantity?: number
          status?: string
          ticker?: string
          user_id?: string
        }
        Relationships: []
      }
      price_alerts: {
        Row: {
          created_at: string
          direction: string
          id: string
          is_triggered: boolean
          target_price: number
          ticker: string
          triggered_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          direction: string
          id?: string
          is_triggered?: boolean
          target_price: number
          ticker: string
          triggered_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          direction?: string
          id?: string
          is_triggered?: boolean
          target_price?: number
          ticker?: string
          triggered_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          disclaimer_accepted_at: string | null
          horizon: string | null
          id: string
          monthly_capital_ars: number | null
          name: string | null
          onboarding_completed: boolean
          risk_tolerance: string | null
          sector_preference: string | null
        }
        Insert: {
          created_at?: string
          disclaimer_accepted_at?: string | null
          horizon?: string | null
          id: string
          monthly_capital_ars?: number | null
          name?: string | null
          onboarding_completed?: boolean
          risk_tolerance?: string | null
          sector_preference?: string | null
        }
        Update: {
          created_at?: string
          disclaimer_accepted_at?: string | null
          horizon?: string | null
          id?: string
          monthly_capital_ars?: number | null
          name?: string | null
          onboarding_completed?: boolean
          risk_tolerance?: string | null
          sector_preference?: string | null
        }
        Relationships: []
      }
      signal_history: {
        Row: {
          confidence: number | null
          confirmed_at: string | null
          confirmed_by_user: boolean
          created_at: string
          id: string
          market_score: number | null
          mep_at_signal: number | null
          price_at_signal_ars: number | null
          price_at_signal_usd: number | null
          reason: string | null
          signal: string
          ticker: string
          user_id: string
        }
        Insert: {
          confidence?: number | null
          confirmed_at?: string | null
          confirmed_by_user?: boolean
          created_at?: string
          id?: string
          market_score?: number | null
          mep_at_signal?: number | null
          price_at_signal_ars?: number | null
          price_at_signal_usd?: number | null
          reason?: string | null
          signal: string
          ticker: string
          user_id: string
        }
        Update: {
          confidence?: number | null
          confirmed_at?: string | null
          confirmed_by_user?: boolean
          created_at?: string
          id?: string
          market_score?: number | null
          mep_at_signal?: number | null
          price_at_signal_ars?: number | null
          price_at_signal_usd?: number | null
          reason?: string | null
          signal?: string
          ticker?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
