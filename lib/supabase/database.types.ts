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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      clients: {
        Row: {
          address: string | null
          client_type: Database["public"]["Enums"]["client_type"]
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          organization_id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          client_type?: Database["public"]["Enums"]["client_type"]
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          client_type?: Database["public"]["Enums"]["client_type"]
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_audit_events: {
        Row: {
          actor_id: string | null
          created_at: string
          document_id: string | null
          event_payload: Json
          event_type: string
          folder_id: string | null
          id: string
          organization_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          document_id?: string | null
          event_payload?: Json
          event_type: string
          folder_id?: string | null
          id?: string
          organization_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          document_id?: string | null
          event_payload?: Json
          event_type?: string
          folder_id?: string | null
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_audit_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_audit_events_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_audit_events_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "document_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_folders: {
        Row: {
          created_at: string
          created_by: string
          deleted_at: string | null
          id: string
          name: string
          organization_id: string
          parent_folder_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          deleted_at?: string | null
          id?: string
          name: string
          organization_id: string
          parent_folder_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          id?: string
          name?: string
          organization_id?: string
          parent_folder_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_folders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_folders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_folders_parent_folder_id_fkey"
            columns: ["parent_folder_id"]
            isOneToOne: false
            referencedRelation: "document_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      document_links: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string
          document_id: string
          employee_id: string | null
          id: string
          job_id: string | null
          organization_id: string
          project_id: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by: string
          document_id: string
          employee_id?: string | null
          id?: string
          job_id?: string | null
          organization_id: string
          project_id?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string
          document_id?: string
          employee_id?: string | null
          id?: string
          job_id?: string | null
          organization_id?: string
          project_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_links_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_links_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_links_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_links_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      document_versions: {
        Row: {
          created_at: string
          document_id: string
          id: string
          mime_type: string | null
          organization_id: string
          original_file_name: string
          size_bytes: number
          storage_bucket: string
          storage_path: string
          uploaded_by: string
          version_number: number
        }
        Insert: {
          created_at?: string
          document_id: string
          id?: string
          mime_type?: string | null
          organization_id: string
          original_file_name: string
          size_bytes: number
          storage_bucket?: string
          storage_path: string
          uploaded_by: string
          version_number: number
        }
        Update: {
          created_at?: string
          document_id?: string
          id?: string
          mime_type?: string | null
          organization_id?: string
          original_file_name?: string
          size_bytes?: number
          storage_bucket?: string
          storage_path?: string
          uploaded_by?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_versions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_versions_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          category: string
          copied_from_document_id: string | null
          created_at: string
          current_version_number: number
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          display_name: string
          folder_id: string | null
          id: string
          metadata: Json
          mime_type: string | null
          organization_id: string
          original_file_name: string
          size_bytes: number
          storage_bucket: string
          storage_path: string
          updated_at: string
          uploaded_by: string
        }
        Insert: {
          category?: string
          copied_from_document_id?: string | null
          created_at?: string
          current_version_number?: number
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          display_name: string
          folder_id?: string | null
          id?: string
          metadata?: Json
          mime_type?: string | null
          organization_id: string
          original_file_name: string
          size_bytes: number
          storage_bucket?: string
          storage_path: string
          updated_at?: string
          uploaded_by: string
        }
        Update: {
          category?: string
          copied_from_document_id?: string | null
          created_at?: string
          current_version_number?: number
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          display_name?: string
          folder_id?: string | null
          id?: string
          metadata?: Json
          mime_type?: string | null
          organization_id?: string
          original_file_name?: string
          size_bytes?: number
          storage_bucket?: string
          storage_path?: string
          updated_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_copied_from_document_id_fkey"
            columns: ["copied_from_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "document_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      entry_change_requests: {
        Row: {
          change_type: Database["public"]["Enums"]["entry_change_type"]
          created_at: string
          entry_id: string
          id: string
          organization_id: string
          original_timestamp: string | null
          paired_entry_id: string | null
          proposed_timestamp: string | null
          requested_by: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["change_request_status"]
          updated_at: string
        }
        Insert: {
          change_type: Database["public"]["Enums"]["entry_change_type"]
          created_at?: string
          entry_id: string
          id?: string
          organization_id: string
          original_timestamp?: string | null
          paired_entry_id?: string | null
          proposed_timestamp?: string | null
          requested_by: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["change_request_status"]
          updated_at?: string
        }
        Update: {
          change_type?: Database["public"]["Enums"]["entry_change_type"]
          created_at?: string
          entry_id?: string
          id?: string
          organization_id?: string
          original_timestamp?: string | null
          paired_entry_id?: string | null
          proposed_timestamp?: string | null
          requested_by?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["change_request_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "entry_change_requests_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "time_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entry_change_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entry_change_requests_paired_entry_id_fkey"
            columns: ["paired_entry_id"]
            isOneToOne: false
            referencedRelation: "time_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      job_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string
          id: string
          job_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by: string
          id?: string
          job_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string
          id?: string
          job_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_assignments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_instruction_items: {
        Row: {
          content: string
          created_at: string
          created_by: string
          id: string
          is_completed: boolean
          job_id: string
          last_status_changed_at: string | null
          last_status_changed_by: string | null
          organization_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by: string
          id?: string
          is_completed?: boolean
          job_id: string
          last_status_changed_at?: string | null
          last_status_changed_by?: string | null
          organization_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string
          id?: string
          is_completed?: boolean
          job_id?: string
          last_status_changed_at?: string | null
          last_status_changed_by?: string | null
          organization_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_instruction_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_instruction_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_instruction_items_last_status_changed_by_fkey"
            columns: ["last_status_changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_instruction_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          actual_completion_date: string | null
          client_id: string | null
          created_at: string
          created_by: string
          description: string | null
          estimated_duration_minutes: number | null
          id: string
          job_number: string | null
          location: string | null
          organization_id: string
          planned_date: string | null
          planned_time: string | null
          planned_working_minutes: number | null
          priority: Database["public"]["Enums"]["job_priority"]
          project_id: string | null
          status: Database["public"]["Enums"]["job_status"]
          title: string
          updated_at: string
        }
        Insert: {
          actual_completion_date?: string | null
          client_id?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          estimated_duration_minutes?: number | null
          id?: string
          job_number?: string | null
          location?: string | null
          organization_id: string
          planned_date?: string | null
          planned_time?: string | null
          planned_working_minutes?: number | null
          priority?: Database["public"]["Enums"]["job_priority"]
          project_id?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          title: string
          updated_at?: string
        }
        Update: {
          actual_completion_date?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          estimated_duration_minutes?: number | null
          id?: string
          job_number?: string | null
          location?: string | null
          organization_id?: string
          planned_date?: string | null
          planned_time?: string | null
          planned_working_minutes?: number | null
          priority?: Database["public"]["Enums"]["job_priority"]
          project_id?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invite_code: string
          invited_role: Database["public"]["Enums"]["org_role"]
          organization_id: string
          status: Database["public"]["Enums"]["invite_status"]
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invite_code: string
          invited_role?: Database["public"]["Enums"]["org_role"]
          organization_id: string
          status?: Database["public"]["Enums"]["invite_status"]
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invite_code?: string
          invited_role?: Database["public"]["Enums"]["org_role"]
          organization_id?: string
          status?: Database["public"]["Enums"]["invite_status"]
        }
        Relationships: [
          {
            foreignKeyName: "organization_invites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          id: string
          joined_at: string
          organization_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          organization_id: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_settings: {
        Row: {
          auto_break_duration_minutes: number
          auto_break_threshold_minutes: number
          break_mode: Database["public"]["Enums"]["time_tracking_break_mode"]
          break_policy_history: Json
          created_at: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          auto_break_duration_minutes?: number
          auto_break_threshold_minutes?: number
          break_mode?: Database["public"]["Enums"]["time_tracking_break_mode"]
          break_policy_history?: Json
          created_at?: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          auto_break_duration_minutes?: number
          auto_break_threshold_minutes?: number
          break_mode?: Database["public"]["Enums"]["time_tracking_break_mode"]
          break_policy_history?: Json
          created_at?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_user_preferences: {
        Row: {
          created_at: string
          organization_id: string
          preferences: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          preferences?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          preferences?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_user_preferences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          admin_id: string
          created_at: string
          id: string
          name: string
          unique_code: string
          updated_at: string
        }
        Insert: {
          admin_id: string
          created_at?: string
          id?: string
          name: string
          unique_code: string
          updated_at?: string
        }
        Update: {
          admin_id?: string
          created_at?: string
          id?: string
          name?: string
          unique_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id: string
          last_name?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      projects: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          name: string
          organization_id: string
          planned_end_date: string | null
          planned_start_date: string | null
          project_number: string | null
          status_override: Database["public"]["Enums"]["project_status"] | null
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          name: string
          organization_id: string
          planned_end_date?: string | null
          planned_start_date?: string | null
          project_number?: string | null
          status_override?: Database["public"]["Enums"]["project_status"] | null
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          planned_end_date?: string | null
          planned_start_date?: string | null
          project_number?: string | null
          status_override?: Database["public"]["Enums"]["project_status"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          created_at: string
          id: string
          plan_id: string | null
          status: Database["public"]["Enums"]["subscription_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          plan_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          plan_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      time_entries: {
        Row: {
          created_at: string
          entry_type: string
          id: string
          is_manual: boolean
          job_id: string | null
          organization_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["time_entry_status"]
          timestamp: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entry_type: string
          id?: string
          is_manual?: boolean
          job_id?: string | null
          organization_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["time_entry_status"]
          timestamp: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          entry_type?: string
          id?: string
          is_manual?: boolean
          job_id?: string | null
          organization_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["time_entry_status"]
          timestamp?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_user_exists_by_email: {
        Args: { p_email: string }
        Returns: {
          user_exists: boolean
          user_id: string
        }[]
      }
      generate_job_number: { Args: { p_org_id: string }; Returns: string }
      generate_project_number: { Args: { p_org_id: string }; Returns: string }
      get_invite_by_code: {
        Args: { p_invite_code: string }
        Returns: {
          email: string
          expires_at: string
          id: string
          invited_role: Database["public"]["Enums"]["org_role"]
          org_name: string
          organization_id: string
          status: Database["public"]["Enums"]["invite_status"]
        }[]
      }
      get_org_clients: {
        Args: { p_org_id: string }
        Returns: {
          address: string | null
          client_type: Database["public"]["Enums"]["client_type"]
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          organization_id: string
          phone: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "clients"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_org_members: {
        Args: { p_org_id: string }
        Returns: {
          email: string
          first_name: string
          joined_at: string
          last_name: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }[]
      }
      get_user_admin_or_manager_org_ids: {
        Args: { p_user_id: string }
        Returns: string[]
      }
      get_user_admin_org_ids: { Args: { p_user_id: string }; Returns: string[] }
      get_user_org_ids: { Args: { p_user_id: string }; Returns: string[] }
      is_member_of_org: {
        Args: { p_org_id: string; p_user_id: string }
        Returns: boolean
      }
      redeem_organization_invite: {
        Args: { p_invite_code: string }
        Returns: {
          already_member: boolean
          org_id: string
          org_name: string
        }[]
      }
    }
    Enums: {
      change_request_status: "pending" | "approved" | "rejected"
      client_type: "privat" | "gewerblich"
      entry_change_type: "edit" | "delete"
      invite_status: "pending" | "accepted" | "expired" | "cancelled"
      job_priority: "niedrig" | "mittel" | "hoch"
      job_status: "nicht_bearbeitet" | "in_bearbeitung" | "fertig" | "geparkt"
      org_role: "admin" | "buero" | "employee"
      project_status:
        | "nicht_begonnen"
        | "in_bearbeitung"
        | "abgeschlossen"
        | "geparkt"
      subscription_status: "active" | "inactive" | "canceled" | "trialing"
      time_entry_status: "pending" | "approved" | "rejected" | "pending_delete"
      time_tracking_break_mode: "manual" | "automatic"
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
    Enums: {
      change_request_status: ["pending", "approved", "rejected"],
      client_type: ["privat", "gewerblich"],
      entry_change_type: ["edit", "delete"],
      invite_status: ["pending", "accepted", "expired", "cancelled"],
      job_priority: ["niedrig", "mittel", "hoch"],
      job_status: ["nicht_bearbeitet", "in_bearbeitung", "fertig", "geparkt"],
      org_role: ["admin", "buero", "employee"],
      project_status: [
        "nicht_begonnen",
        "in_bearbeitung",
        "abgeschlossen",
        "geparkt",
      ],
      subscription_status: ["active", "inactive", "canceled", "trialing"],
      time_entry_status: ["pending", "approved", "rejected", "pending_delete"],
      time_tracking_break_mode: ["manual", "automatic"],
    },
  },
} as const
