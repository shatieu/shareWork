export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      access_tokens: {
        Row: {
          created_at: string
          id: string
          last_used_at: string | null
          name: string
          team_id: string
          token_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_used_at?: string | null
          name: string
          team_id: string
          token_hash: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_used_at?: string | null
          name?: string
          team_id?: string
          token_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          created_by: string
          default_branch: string
          id: string
          name: string
          repo_url: string | null
          setup_profile: Database["public"]["Enums"]["setup_profile"]
          team_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          default_branch?: string
          id?: string
          name: string
          repo_url?: string | null
          setup_profile?: Database["public"]["Enums"]["setup_profile"]
          team_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          default_branch?: string
          id?: string
          name?: string
          repo_url?: string | null
          setup_profile?: Database["public"]["Enums"]["setup_profile"]
          team_id?: string
        }
        Relationships: []
      }
      task_events: {
        Row: {
          actor_id: string | null
          actor_kind: Database["public"]["Enums"]["actor_kind"]
          created_at: string
          id: string
          message: string | null
          payload: Json
          task_id: string
          team_id: string
          type: Database["public"]["Enums"]["event_type"]
        }
        Insert: {
          actor_id?: string | null
          actor_kind?: Database["public"]["Enums"]["actor_kind"]
          created_at?: string
          id?: string
          message?: string | null
          payload?: Json
          task_id: string
          team_id: string
          type: Database["public"]["Enums"]["event_type"]
        }
        Update: {
          actor_id?: string | null
          actor_kind?: Database["public"]["Enums"]["actor_kind"]
          created_at?: string
          id?: string
          message?: string | null
          payload?: Json
          task_id?: string
          team_id?: string
          type?: Database["public"]["Enums"]["event_type"]
        }
        Relationships: []
      }
      tasks: {
        Row: {
          acceptance: Json
          assignee_id: string | null
          branch: string | null
          created_at: string
          created_by: string
          env_required: string[]
          handover_md: string | null
          id: string
          pr_url: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          project_id: string
          spec_md: string
          status: Database["public"]["Enums"]["task_status"]
          team_id: string
          title: string
          updated_at: string
        }
        Insert: {
          acceptance?: Json
          assignee_id?: string | null
          branch?: string | null
          created_at?: string
          created_by: string
          env_required?: string[]
          handover_md?: string | null
          id?: string
          pr_url?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          project_id: string
          spec_md?: string
          status?: Database["public"]["Enums"]["task_status"]
          team_id: string
          title: string
          updated_at?: string
        }
        Update: {
          acceptance?: Json
          assignee_id?: string | null
          branch?: string | null
          created_at?: string
          created_by?: string
          env_required?: string[]
          handover_md?: string | null
          id?: string
          pr_url?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          project_id?: string
          spec_md?: string
          status?: Database["public"]["Enums"]["task_status"]
          team_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      team_members: {
        Row: {
          created_at: string
          role: Database["public"]["Enums"]["team_role"]
          team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          role?: Database["public"]["Enums"]["team_role"]
          team_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          role?: Database["public"]["Enums"]["team_role"]
          team_id?: string
          user_id?: string
        }
        Relationships: []
      }
      teams: {
        Row: {
          created_at: string
          created_by: string
          id: string
          join_code: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          join_code?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          join_code?: string
          name?: string
        }
        Relationships: []
      }
    }
    Views: Record<never, never>
    Functions: {
      create_team: {
        Args: { _name: string }
        Returns: Database["public"]["Tables"]["teams"]["Row"]
      }
      is_team_admin: { Args: { _team_id: string }; Returns: boolean }
      is_team_member: { Args: { _team_id: string }; Returns: boolean }
      join_team: {
        Args: { _code: string }
        Returns: Database["public"]["Tables"]["teams"]["Row"]
      }
      shares_team_with: { Args: { _user: string }; Returns: boolean }
    }
    Enums: {
      actor_kind: "human" | "agent"
      event_type:
        | "created"
        | "claimed"
        | "progress"
        | "submitted"
        | "approved"
        | "changes_requested"
        | "blocked"
        | "comment"
        | "reopened"
      setup_profile: "nextjs-supabase-vercel" | "python-service" | "minimal"
      task_priority: "low" | "normal" | "high"
      task_status:
        | "open"
        | "claimed"
        | "in_progress"
        | "in_review"
        | "changes_requested"
        | "done"
        | "blocked"
      team_role: "owner" | "admin" | "member"
    }
    CompositeTypes: Record<never, never>
  }
}

type PublicSchema = Database["public"]

export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"]
export type Enums<T extends keyof PublicSchema["Enums"]> =
  PublicSchema["Enums"][T]

// Domain aliases
export type Profile = Tables<"profiles">
export type Team = Tables<"teams">
export type TeamMember = Tables<"team_members">
export type Project = Tables<"projects">
export type Task = Tables<"tasks">
export type TaskEvent = Tables<"task_events">
export type AccessToken = Tables<"access_tokens">

export type TaskStatus = Enums<"task_status">
export type TaskPriority = Enums<"task_priority">
export type SetupProfile = Enums<"setup_profile">
export type EventType = Enums<"event_type">
export type TeamRole = Enums<"team_role">

export type AcceptanceItem = { text: string; done: boolean }
