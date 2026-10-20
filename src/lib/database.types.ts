
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "audit_log": {
                  Row: {
                    "action": string,"actor_id": string | null,"actor_role": Database["public"]['Enums']["user_role"] | null,"at": string,"changes": Json | null,"id": number,"new_row": Json | null,"old_row": Json | null,"row_id": string,"table_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"actor_role"?: Database["public"]['Enums']["user_role"] | null,"at"?: string,"changes"?: Json | null,"id"?: never,"new_row"?: Json | null,"old_row"?: Json | null,"row_id": string,"table_name": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"actor_role"?: Database["public"]['Enums']["user_role"] | null,"at"?: string,"changes"?: Json | null,"id"?: never,"new_row"?: Json | null,"old_row"?: Json | null,"row_id"?: string,"table_name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"markets": {
                  Row: {
                    "address": string | null,"archived_at": string | null,"created_at": string,"id": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"archived_at"?: string | null,"created_at"?: string,"id"?: string,"name": string
                  }
                  Update: {
                    "address"?: string | null,"archived_at"?: string | null,"created_at"?: string,"id"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"full_name": string,"id": string,"role": Database["public"]['Enums']["user_role"]
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"full_name"?: string,"id": string,"role"?: Database["public"]['Enums']["user_role"]
                  }
                  Update: {
                    "created_at"?: string,"full_name"?: string,"id"?: string,"role"?: Database["public"]['Enums']["user_role"]
                  }
                  Relationships: [
                    
                  ]
                },"standard_route": {
                  Row: {
                    "created_at": string,"id": string,"market_id": string,"position": number,"repositor_id": string,"weekday": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"market_id": string,"position"?: number,"repositor_id": string,"weekday": number
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"market_id"?: string,"position"?: number,"repositor_id"?: string,"weekday"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "standard_route_market_id_fkey"
      columns: ["market_id"]
isOneToOne: false
      referencedRelation: "markets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "standard_route_repositor_id_fkey"
      columns: ["repositor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"visit_events": {
                  Row: {
                    "actor_id": string,"client_event_id": string,"id": string,"occurred_at": string,"occurred_local_date": string,"payload": NonNullable<Json>,"received_at": string,"type": string,"visit_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id": string,"client_event_id": string,"id"?: string,"occurred_at": string,"occurred_local_date": string,"payload"?: NonNullable<Json>,"received_at"?: string,"type": string,"visit_id": string
                  }
                  Update: {
                    "actor_id"?: string,"client_event_id"?: string,"id"?: string,"occurred_at"?: string,"occurred_local_date"?: string,"payload"?: NonNullable<Json>,"received_at"?: string,"type"?: string,"visit_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "visit_events_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visit_events_visit_id_fkey"
      columns: ["visit_id"]
isOneToOne: false
      referencedRelation: "visits"
      referencedColumns: ["id"]
    }
                  ]
                },"visits": {
                  Row: {
                    "carried_from_date": string | null,"check_in_at": string | null,"check_out_at": string | null,"created_at": string,"id": string,"market_id": string,"note": string | null,"origin": Database["public"]['Enums']["visit_origin"],"position": number,"repositor_id": string,"skip_reason": string | null,"status": Database["public"]['Enums']["visit_status"],"updated_at": string,"visit_date": string
                  }
                  ComputedFields: never
                  Insert: {
                    "carried_from_date"?: string | null,"check_in_at"?: string | null,"check_out_at"?: string | null,"created_at"?: string,"id"?: string,"market_id": string,"note"?: string | null,"origin"?: Database["public"]['Enums']["visit_origin"],"position"?: number,"repositor_id": string,"skip_reason"?: string | null,"status"?: Database["public"]['Enums']["visit_status"],"updated_at"?: string,"visit_date": string
                  }
                  Update: {
                    "carried_from_date"?: string | null,"check_in_at"?: string | null,"check_out_at"?: string | null,"created_at"?: string,"id"?: string,"market_id"?: string,"note"?: string | null,"origin"?: Database["public"]['Enums']["visit_origin"],"position"?: number,"repositor_id"?: string,"skip_reason"?: string | null,"status"?: Database["public"]['Enums']["visit_status"],"updated_at"?: string,"visit_date"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "visits_market_id_fkey"
      columns: ["market_id"]
isOneToOne: false
      referencedRelation: "markets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visits_repositor_id_fkey"
      columns: ["repositor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "is_leader":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           }
          }
          Enums: {
            "user_role": "repositor"|"leader","visit_origin": "standard"|"exception"|"carryover","visit_status": "planned"|"in_progress"|"done"|"not_done"|"cancelled"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "user_role": ["repositor", "leader"],"visit_origin": ["standard", "exception", "carryover"],"visit_status": ["planned", "in_progress", "done", "not_done", "cancelled"]
          }
        }
} as const
