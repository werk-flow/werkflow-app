export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
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
      attention_events: {
        Row: {
          created_at: string;
          event_payload: Json;
          event_type: string;
          id: string;
          organization_id: string;
          source_id: string;
          source_type: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          event_payload?: Json;
          event_type: string;
          id?: string;
          organization_id: string;
          source_id: string;
          source_type: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          event_payload?: Json;
          event_type?: string;
          id?: string;
          organization_id?: string;
          source_id?: string;
          source_type?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "attention_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      attention_read_states: {
        Row: {
          created_at: string;
          id: string;
          organization_id: string;
          read_at: string;
          source_id: string;
          source_type: string;
          state_version: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          organization_id: string;
          read_at?: string;
          source_id: string;
          source_type: string;
          state_version: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          organization_id?: string;
          read_at?: string;
          source_id?: string;
          source_type?: string;
          state_version?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "attention_read_states_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      client_communication_preference_events: {
        Row: {
          actor_id: string;
          client_id: string;
          created_at: string;
          event_payload: Json;
          event_type: string;
          id: string;
          organization_id: string;
          preference_id: string | null;
        };
        Insert: {
          actor_id: string;
          client_id: string;
          created_at?: string;
          event_payload?: Json;
          event_type: string;
          id?: string;
          organization_id: string;
          preference_id?: string | null;
        };
        Update: {
          actor_id?: string;
          client_id?: string;
          created_at?: string;
          event_payload?: Json;
          event_type?: string;
          id?: string;
          organization_id?: string;
          preference_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "client_communication_preference_events_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_communication_preference_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_communication_preference_events_preference_id_fkey";
            columns: ["preference_id"];
            isOneToOne: false;
            referencedRelation: "client_communication_preferences";
            referencedColumns: ["id"];
          },
        ];
      };
      client_communication_preferences: {
        Row: {
          channel: string;
          client_id: string;
          contact_id: string | null;
          created_at: string;
          created_by: string;
          id: string;
          organization_id: string;
          purpose: string;
          source_note: string | null;
          state: string;
          updated_at: string;
          updated_by: string;
        };
        Insert: {
          channel: string;
          client_id: string;
          contact_id?: string | null;
          created_at?: string;
          created_by: string;
          id?: string;
          organization_id: string;
          purpose: string;
          source_note?: string | null;
          state: string;
          updated_at?: string;
          updated_by: string;
        };
        Update: {
          channel?: string;
          client_id?: string;
          contact_id?: string | null;
          created_at?: string;
          created_by?: string;
          id?: string;
          organization_id?: string;
          purpose?: string;
          source_note?: string | null;
          state?: string;
          updated_at?: string;
          updated_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_communication_preferences_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_communication_preferences_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "client_contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_communication_preferences_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      client_communication_settings: {
        Row: {
          accessibility_note: string | null;
          client_id: string;
          contact_time_note: string | null;
          created_at: string;
          created_by: string;
          do_not_contact_instruction: string | null;
          id: string;
          language_note: string | null;
          organization_id: string;
          preferred_channel: string | null;
          preferred_contact_id: string | null;
          source_note: string | null;
          updated_at: string;
          updated_by: string;
        };
        Insert: {
          accessibility_note?: string | null;
          client_id: string;
          contact_time_note?: string | null;
          created_at?: string;
          created_by: string;
          do_not_contact_instruction?: string | null;
          id?: string;
          language_note?: string | null;
          organization_id: string;
          preferred_channel?: string | null;
          preferred_contact_id?: string | null;
          source_note?: string | null;
          updated_at?: string;
          updated_by: string;
        };
        Update: {
          accessibility_note?: string | null;
          client_id?: string;
          contact_time_note?: string | null;
          created_at?: string;
          created_by?: string;
          do_not_contact_instruction?: string | null;
          id?: string;
          language_note?: string | null;
          organization_id?: string;
          preferred_channel?: string | null;
          preferred_contact_id?: string | null;
          source_note?: string | null;
          updated_at?: string;
          updated_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_communication_settings_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_communication_settings_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_communication_settings_preferred_contact_id_fkey";
            columns: ["preferred_contact_id"];
            isOneToOne: false;
            referencedRelation: "client_contacts";
            referencedColumns: ["id"];
          },
        ];
      };
      client_contacts: {
        Row: {
          client_id: string;
          created_at: string;
          created_by: string | null;
          email: string | null;
          id: string;
          is_active: boolean;
          is_primary: boolean;
          name: string;
          notes: string | null;
          organization_id: string;
          phone: string | null;
          role: string | null;
          updated_at: string;
        };
        Insert: {
          client_id: string;
          created_at?: string;
          created_by?: string | null;
          email?: string | null;
          id?: string;
          is_active?: boolean;
          is_primary?: boolean;
          name: string;
          notes?: string | null;
          organization_id: string;
          phone?: string | null;
          role?: string | null;
          updated_at?: string;
        };
        Update: {
          client_id?: string;
          created_at?: string;
          created_by?: string | null;
          email?: string | null;
          id?: string;
          is_active?: boolean;
          is_primary?: boolean;
          name?: string;
          notes?: string | null;
          organization_id?: string;
          phone?: string | null;
          role?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_contacts_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_contacts_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_contacts_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      client_follow_up_events: {
        Row: {
          actor_id: string;
          client_id: string;
          created_at: string;
          event_payload: Json;
          event_type: string;
          follow_up_id: string;
          id: string;
          organization_id: string;
        };
        Insert: {
          actor_id: string;
          client_id: string;
          created_at?: string;
          event_payload?: Json;
          event_type: string;
          follow_up_id: string;
          id?: string;
          organization_id: string;
        };
        Update: {
          actor_id?: string;
          client_id?: string;
          created_at?: string;
          event_payload?: Json;
          event_type?: string;
          follow_up_id?: string;
          id?: string;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_follow_up_events_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_follow_up_events_follow_up_id_fkey";
            columns: ["follow_up_id"];
            isOneToOne: false;
            referencedRelation: "client_follow_ups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_follow_up_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      client_follow_ups: {
        Row: {
          cancelled_at: string | null;
          cancelled_by: string | null;
          client_id: string;
          completed_at: string | null;
          completed_by: string | null;
          created_at: string;
          created_by: string;
          due_at: string;
          id: string;
          note: string | null;
          organization_id: string;
          owner_user_id: string;
          resolution_note: string | null;
          source_id: string | null;
          source_type: string | null;
          status: string;
          title: string;
          updated_at: string;
          updated_by: string;
        };
        Insert: {
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          client_id: string;
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          created_by: string;
          due_at: string;
          id?: string;
          note?: string | null;
          organization_id: string;
          owner_user_id: string;
          resolution_note?: string | null;
          source_id?: string | null;
          source_type?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
          updated_by: string;
        };
        Update: {
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          client_id?: string;
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          created_by?: string;
          due_at?: string;
          id?: string;
          note?: string | null;
          organization_id?: string;
          owner_user_id?: string;
          resolution_note?: string | null;
          source_id?: string | null;
          source_type?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
          updated_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_follow_ups_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_follow_ups_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      client_request_events: {
        Row: {
          created_at: string;
          created_by: string | null;
          event_payload: Json;
          event_type: string;
          id: string;
          organization_id: string;
          request_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          event_payload?: Json;
          event_type: string;
          id?: string;
          organization_id: string;
          request_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          event_payload?: Json;
          event_type?: string;
          id?: string;
          organization_id?: string;
          request_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_request_events_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_request_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_request_events_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "client_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      client_requests: {
        Row: {
          assigned_to: string | null;
          caller_address: string | null;
          caller_email: string | null;
          caller_name: string | null;
          caller_phone: string | null;
          category: Database["public"]["Enums"]["request_category"];
          client_id: string | null;
          closed_at: string | null;
          closed_by: string | null;
          closed_note: string | null;
          closed_reason:
            | Database["public"]["Enums"]["request_close_reason"]
            | null;
          contact_id: string | null;
          converted_at: string | null;
          converted_by: string | null;
          converted_job_id: string | null;
          converted_project_id: string | null;
          created_at: string;
          created_by: string | null;
          details: string | null;
          id: string;
          organization_id: string;
          received_at: string;
          request_number: string | null;
          site_id: string | null;
          source: Database["public"]["Enums"]["request_source"];
          status: Database["public"]["Enums"]["request_status"];
          summary: string;
          updated_at: string;
          urgency: Database["public"]["Enums"]["request_urgency"];
        };
        Insert: {
          assigned_to?: string | null;
          caller_address?: string | null;
          caller_email?: string | null;
          caller_name?: string | null;
          caller_phone?: string | null;
          category?: Database["public"]["Enums"]["request_category"];
          client_id?: string | null;
          closed_at?: string | null;
          closed_by?: string | null;
          closed_note?: string | null;
          closed_reason?:
            | Database["public"]["Enums"]["request_close_reason"]
            | null;
          contact_id?: string | null;
          converted_at?: string | null;
          converted_by?: string | null;
          converted_job_id?: string | null;
          converted_project_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          details?: string | null;
          id?: string;
          organization_id: string;
          received_at?: string;
          request_number?: string | null;
          site_id?: string | null;
          source?: Database["public"]["Enums"]["request_source"];
          status?: Database["public"]["Enums"]["request_status"];
          summary: string;
          updated_at?: string;
          urgency?: Database["public"]["Enums"]["request_urgency"];
        };
        Update: {
          assigned_to?: string | null;
          caller_address?: string | null;
          caller_email?: string | null;
          caller_name?: string | null;
          caller_phone?: string | null;
          category?: Database["public"]["Enums"]["request_category"];
          client_id?: string | null;
          closed_at?: string | null;
          closed_by?: string | null;
          closed_note?: string | null;
          closed_reason?:
            | Database["public"]["Enums"]["request_close_reason"]
            | null;
          contact_id?: string | null;
          converted_at?: string | null;
          converted_by?: string | null;
          converted_job_id?: string | null;
          converted_project_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          details?: string | null;
          id?: string;
          organization_id?: string;
          received_at?: string;
          request_number?: string | null;
          site_id?: string | null;
          source?: Database["public"]["Enums"]["request_source"];
          status?: Database["public"]["Enums"]["request_status"];
          summary?: string;
          updated_at?: string;
          urgency?: Database["public"]["Enums"]["request_urgency"];
        };
        Relationships: [
          {
            foreignKeyName: "client_requests_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_requests_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_requests_closed_by_fkey";
            columns: ["closed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_requests_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "client_contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_requests_converted_by_fkey";
            columns: ["converted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_requests_converted_job_id_fkey";
            columns: ["converted_job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_requests_converted_project_id_fkey";
            columns: ["converted_project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_requests_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_requests_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_requests_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "client_sites";
            referencedColumns: ["id"];
          },
        ];
      };
      client_sites: {
        Row: {
          access_notes: string | null;
          city: string | null;
          client_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          is_active: boolean;
          is_primary: boolean;
          name: string;
          notes: string | null;
          organization_id: string;
          postal_code: string | null;
          primary_contact_id: string | null;
          street: string | null;
          updated_at: string;
        };
        Insert: {
          access_notes?: string | null;
          city?: string | null;
          client_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_active?: boolean;
          is_primary?: boolean;
          name: string;
          notes?: string | null;
          organization_id: string;
          postal_code?: string | null;
          primary_contact_id?: string | null;
          street?: string | null;
          updated_at?: string;
        };
        Update: {
          access_notes?: string | null;
          city?: string | null;
          client_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_active?: boolean;
          is_primary?: boolean;
          name?: string;
          notes?: string | null;
          organization_id?: string;
          postal_code?: string | null;
          primary_contact_id?: string | null;
          street?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_sites_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_sites_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_sites_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_sites_primary_contact_id_fkey";
            columns: ["primary_contact_id"];
            isOneToOne: false;
            referencedRelation: "client_contacts";
            referencedColumns: ["id"];
          },
        ];
      };
      clients: {
        Row: {
          address: string | null;
          client_type: Database["public"]["Enums"]["client_type"];
          created_at: string;
          customer_number: string | null;
          email: string | null;
          id: string;
          name: string;
          notes: string | null;
          organization_id: string;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          client_type?: Database["public"]["Enums"]["client_type"];
          created_at?: string;
          customer_number?: string | null;
          email?: string | null;
          id?: string;
          name: string;
          notes?: string | null;
          organization_id: string;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          client_type?: Database["public"]["Enums"]["client_type"];
          created_at?: string;
          customer_number?: string | null;
          email?: string | null;
          id?: string;
          name?: string;
          notes?: string | null;
          organization_id?: string;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "clients_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      document_audit_events: {
        Row: {
          actor_id: string | null;
          created_at: string;
          document_id: string | null;
          event_payload: Json;
          event_type: string;
          folder_id: string | null;
          id: string;
          organization_id: string;
        };
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          document_id?: string | null;
          event_payload?: Json;
          event_type: string;
          folder_id?: string | null;
          id?: string;
          organization_id: string;
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          document_id?: string | null;
          event_payload?: Json;
          event_type?: string;
          folder_id?: string | null;
          id?: string;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_audit_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_audit_events_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_audit_events_folder_id_fkey";
            columns: ["folder_id"];
            isOneToOne: false;
            referencedRelation: "document_folders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_audit_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      document_folders: {
        Row: {
          created_at: string;
          created_by: string;
          deleted_at: string | null;
          id: string;
          name: string;
          organization_id: string;
          parent_folder_id: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          deleted_at?: string | null;
          id?: string;
          name: string;
          organization_id: string;
          parent_folder_id?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          deleted_at?: string | null;
          id?: string;
          name?: string;
          organization_id?: string;
          parent_folder_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_folders_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_folders_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_folders_parent_folder_id_fkey";
            columns: ["parent_folder_id"];
            isOneToOne: false;
            referencedRelation: "document_folders";
            referencedColumns: ["id"];
          },
        ];
      };
      document_links: {
        Row: {
          client_id: string | null;
          created_at: string;
          created_by: string;
          document_id: string;
          employee_id: string | null;
          equipment_id: string | null;
          id: string;
          job_id: string | null;
          organization_id: string;
          project_id: string | null;
          request_id: string | null;
          service_case_id: string | null;
        };
        Insert: {
          client_id?: string | null;
          created_at?: string;
          created_by: string;
          document_id: string;
          employee_id?: string | null;
          equipment_id?: string | null;
          id?: string;
          job_id?: string | null;
          organization_id: string;
          project_id?: string | null;
          request_id?: string | null;
          service_case_id?: string | null;
        };
        Update: {
          client_id?: string | null;
          created_at?: string;
          created_by?: string;
          document_id?: string;
          employee_id?: string | null;
          equipment_id?: string | null;
          id?: string;
          job_id?: string | null;
          organization_id?: string;
          project_id?: string | null;
          request_id?: string | null;
          service_case_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "document_links_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_links_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_links_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_links_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_links_equipment_fk";
            columns: ["equipment_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "installed_equipment";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "document_links_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_links_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_links_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_links_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "client_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_links_service_case_id_fkey";
            columns: ["service_case_id"];
            isOneToOne: false;
            referencedRelation: "service_cases";
            referencedColumns: ["id"];
          },
        ];
      };
      document_versions: {
        Row: {
          created_at: string;
          document_id: string;
          id: string;
          mime_type: string | null;
          organization_id: string;
          original_file_name: string;
          size_bytes: number;
          storage_bucket: string;
          storage_path: string;
          uploaded_by: string;
          version_number: number;
        };
        Insert: {
          created_at?: string;
          document_id: string;
          id?: string;
          mime_type?: string | null;
          organization_id: string;
          original_file_name: string;
          size_bytes: number;
          storage_bucket?: string;
          storage_path: string;
          uploaded_by: string;
          version_number: number;
        };
        Update: {
          created_at?: string;
          document_id?: string;
          id?: string;
          mime_type?: string | null;
          organization_id?: string;
          original_file_name?: string;
          size_bytes?: number;
          storage_bucket?: string;
          storage_path?: string;
          uploaded_by?: string;
          version_number?: number;
        };
        Relationships: [
          {
            foreignKeyName: "document_versions_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_versions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_versions_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      documents: {
        Row: {
          category: string;
          copied_from_document_id: string | null;
          created_at: string;
          current_version_number: number;
          delete_reason: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          display_name: string;
          folder_id: string | null;
          id: string;
          metadata: Json;
          mime_type: string | null;
          organization_id: string;
          original_file_name: string;
          size_bytes: number;
          storage_bucket: string;
          storage_path: string;
          updated_at: string;
          uploaded_by: string;
        };
        Insert: {
          category?: string;
          copied_from_document_id?: string | null;
          created_at?: string;
          current_version_number?: number;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          display_name: string;
          folder_id?: string | null;
          id?: string;
          metadata?: Json;
          mime_type?: string | null;
          organization_id: string;
          original_file_name: string;
          size_bytes: number;
          storage_bucket?: string;
          storage_path: string;
          updated_at?: string;
          uploaded_by: string;
        };
        Update: {
          category?: string;
          copied_from_document_id?: string | null;
          created_at?: string;
          current_version_number?: number;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          display_name?: string;
          folder_id?: string | null;
          id?: string;
          metadata?: Json;
          mime_type?: string | null;
          organization_id?: string;
          original_file_name?: string;
          size_bytes?: number;
          storage_bucket?: string;
          storage_path?: string;
          updated_at?: string;
          uploaded_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "documents_copied_from_document_id_fkey";
            columns: ["copied_from_document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_deleted_by_fkey";
            columns: ["deleted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_folder_id_fkey";
            columns: ["folder_id"];
            isOneToOne: false;
            referencedRelation: "document_folders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      email_change_challenges: {
        Row: {
          created_at: string;
          current_email: string;
          current_email_attempt_count: number;
          current_email_code_expires_at: string | null;
          current_email_code_hash: string | null;
          current_email_last_sent_at: string | null;
          current_email_verified_at: string | null;
          current_email_verified_expires_at: string | null;
          new_email: string | null;
          new_email_attempt_count: number;
          new_email_code_expires_at: string | null;
          new_email_code_hash: string | null;
          new_email_last_sent_at: string | null;
          new_email_requested_at: string | null;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          current_email: string;
          current_email_attempt_count?: number;
          current_email_code_expires_at?: string | null;
          current_email_code_hash?: string | null;
          current_email_last_sent_at?: string | null;
          current_email_verified_at?: string | null;
          current_email_verified_expires_at?: string | null;
          new_email?: string | null;
          new_email_attempt_count?: number;
          new_email_code_expires_at?: string | null;
          new_email_code_hash?: string | null;
          new_email_last_sent_at?: string | null;
          new_email_requested_at?: string | null;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          current_email?: string;
          current_email_attempt_count?: number;
          current_email_code_expires_at?: string | null;
          current_email_code_hash?: string | null;
          current_email_last_sent_at?: string | null;
          current_email_verified_at?: string | null;
          current_email_verified_expires_at?: string | null;
          new_email?: string | null;
          new_email_attempt_count?: number;
          new_email_code_expires_at?: string | null;
          new_email_code_hash?: string | null;
          new_email_last_sent_at?: string | null;
          new_email_requested_at?: string | null;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      employee_capabilities: {
        Row: {
          capability_id: string;
          capability_kind: string;
          confirmation_status: string;
          confirmed_at: string | null;
          confirmed_by: string | null;
          created_at: string;
          created_by: string | null;
          employee_record_id: string;
          evidence_state: string;
          id: string;
          issuer: string | null;
          operational_note: string | null;
          organization_id: string;
          renewal_due_date: string | null;
          superseded_at: string | null;
          supersedes_id: string | null;
          updated_at: string;
          updated_by: string | null;
          valid_from: string;
          valid_until: string | null;
        };
        Insert: {
          capability_id: string;
          capability_kind: string;
          confirmation_status?: string;
          confirmed_at?: string | null;
          confirmed_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          employee_record_id: string;
          evidence_state?: string;
          id?: string;
          issuer?: string | null;
          operational_note?: string | null;
          organization_id: string;
          renewal_due_date?: string | null;
          superseded_at?: string | null;
          supersedes_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          valid_from: string;
          valid_until?: string | null;
        };
        Update: {
          capability_id?: string;
          capability_kind?: string;
          confirmation_status?: string;
          confirmed_at?: string | null;
          confirmed_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          employee_record_id?: string;
          evidence_state?: string;
          id?: string;
          issuer?: string | null;
          operational_note?: string | null;
          organization_id?: string;
          renewal_due_date?: string | null;
          superseded_at?: string | null;
          supersedes_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          valid_from?: string;
          valid_until?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "employee_capabilities_capability_id_fkey";
            columns: ["capability_id"];
            isOneToOne: false;
            referencedRelation: "organization_capabilities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "employee_capabilities_employee_record_id_fkey";
            columns: ["employee_record_id"];
            isOneToOne: false;
            referencedRelation: "employee_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "employee_capabilities_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "employee_capabilities_supersedes_id_fkey";
            columns: ["supersedes_id"];
            isOneToOne: false;
            referencedRelation: "employee_capabilities";
            referencedColumns: ["id"];
          },
        ];
      };
      employee_record_events: {
        Row: {
          created_at: string;
          created_by: string | null;
          employee_record_id: string;
          event_payload: Json;
          event_type: string;
          id: string;
          organization_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          employee_record_id: string;
          event_payload?: Json;
          event_type: string;
          id?: string;
          organization_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          employee_record_id?: string;
          event_payload?: Json;
          event_type?: string;
          id?: string;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "employee_record_events_employee_record_id_fkey";
            columns: ["employee_record_id"];
            isOneToOne: false;
            referencedRelation: "employee_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "employee_record_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      employee_records: {
        Row: {
          city: string | null;
          created_at: string;
          created_by: string | null;
          emergency_contact_name: string | null;
          emergency_contact_phone: string | null;
          employee_number: string | null;
          entry_date: string | null;
          exit_date: string | null;
          first_name: string | null;
          id: string;
          invite_id: string | null;
          last_name: string | null;
          notes: string | null;
          organization_id: string;
          phone: string | null;
          postal_code: string | null;
          private_email: string | null;
          street: string | null;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          city?: string | null;
          created_at?: string;
          created_by?: string | null;
          emergency_contact_name?: string | null;
          emergency_contact_phone?: string | null;
          employee_number?: string | null;
          entry_date?: string | null;
          exit_date?: string | null;
          first_name?: string | null;
          id?: string;
          invite_id?: string | null;
          last_name?: string | null;
          notes?: string | null;
          organization_id: string;
          phone?: string | null;
          postal_code?: string | null;
          private_email?: string | null;
          street?: string | null;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          city?: string | null;
          created_at?: string;
          created_by?: string | null;
          emergency_contact_name?: string | null;
          emergency_contact_phone?: string | null;
          employee_number?: string | null;
          entry_date?: string | null;
          exit_date?: string | null;
          first_name?: string | null;
          id?: string;
          invite_id?: string | null;
          last_name?: string | null;
          notes?: string | null;
          organization_id?: string;
          phone?: string | null;
          postal_code?: string | null;
          private_email?: string | null;
          street?: string | null;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "employee_records_invite_id_fkey";
            columns: ["invite_id"];
            isOneToOne: false;
            referencedRelation: "organization_invites";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "employee_records_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      employment_conditions: {
        Row: {
          created_at: string;
          created_by: string | null;
          employee_record_id: string;
          employment_type: string;
          id: string;
          note: string | null;
          organization_id: string;
          updated_at: string;
          vacation_days_per_year: number | null;
          valid_from: string;
          weekly_hours: number | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          employee_record_id: string;
          employment_type: string;
          id?: string;
          note?: string | null;
          organization_id: string;
          updated_at?: string;
          vacation_days_per_year?: number | null;
          valid_from: string;
          weekly_hours?: number | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          employee_record_id?: string;
          employment_type?: string;
          id?: string;
          note?: string | null;
          organization_id?: string;
          updated_at?: string;
          vacation_days_per_year?: number | null;
          valid_from?: string;
          weekly_hours?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "employment_conditions_employee_record_id_fkey";
            columns: ["employee_record_id"];
            isOneToOne: false;
            referencedRelation: "employee_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "employment_conditions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      entry_change_requests: {
        Row: {
          change_type: Database["public"]["Enums"]["entry_change_type"];
          created_at: string;
          entry_id: string;
          id: string;
          organization_id: string;
          original_timestamp: string | null;
          paired_entry_id: string | null;
          proposed_timestamp: string | null;
          requested_by: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: Database["public"]["Enums"]["change_request_status"];
          updated_at: string;
        };
        Insert: {
          change_type: Database["public"]["Enums"]["entry_change_type"];
          created_at?: string;
          entry_id: string;
          id?: string;
          organization_id: string;
          original_timestamp?: string | null;
          paired_entry_id?: string | null;
          proposed_timestamp?: string | null;
          requested_by: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database["public"]["Enums"]["change_request_status"];
          updated_at?: string;
        };
        Update: {
          change_type?: Database["public"]["Enums"]["entry_change_type"];
          created_at?: string;
          entry_id?: string;
          id?: string;
          organization_id?: string;
          original_timestamp?: string | null;
          paired_entry_id?: string | null;
          proposed_timestamp?: string | null;
          requested_by?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database["public"]["Enums"]["change_request_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "entry_change_requests_entry_id_fkey";
            columns: ["entry_id"];
            isOneToOne: false;
            referencedRelation: "time_entries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "entry_change_requests_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "entry_change_requests_paired_entry_id_fkey";
            columns: ["paired_entry_id"];
            isOneToOne: false;
            referencedRelation: "time_entries";
            referencedColumns: ["id"];
          },
        ];
      };
      installed_equipment: {
        Row: {
          archive_reason: string | null;
          archived_at: string | null;
          archived_by: string | null;
          category: Database["public"]["Enums"]["installed_equipment_category"];
          client_id: string;
          commissioning_date: string | null;
          created_at: string;
          created_by: string;
          equipment_number: string;
          id: string;
          installation_date: string | null;
          location_detail: string | null;
          manufacturer: string | null;
          model: string | null;
          name: string;
          organization_id: string;
          parent_equipment_id: string | null;
          predecessor_equipment_id: string | null;
          site_id: string;
          state: Database["public"]["Enums"]["installed_equipment_state"];
          subtype:
            | Database["public"]["Enums"]["installed_equipment_subtype"]
            | null;
          technical_notes: string | null;
          updated_at: string;
          updated_by: string;
          version: number;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
          warranty_basis: string | null;
          warranty_end_date: string | null;
          warranty_provider: string | null;
          warranty_start_date: string | null;
        };
        Insert: {
          archive_reason?: string | null;
          archived_at?: string | null;
          archived_by?: string | null;
          category: Database["public"]["Enums"]["installed_equipment_category"];
          client_id: string;
          commissioning_date?: string | null;
          created_at?: string;
          created_by: string;
          equipment_number: string;
          id?: string;
          installation_date?: string | null;
          location_detail?: string | null;
          manufacturer?: string | null;
          model?: string | null;
          name: string;
          organization_id: string;
          parent_equipment_id?: string | null;
          predecessor_equipment_id?: string | null;
          site_id: string;
          state: Database["public"]["Enums"]["installed_equipment_state"];
          subtype?:
            | Database["public"]["Enums"]["installed_equipment_subtype"]
            | null;
          technical_notes?: string | null;
          updated_at?: string;
          updated_by: string;
          version?: number;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
          warranty_basis?: string | null;
          warranty_end_date?: string | null;
          warranty_provider?: string | null;
          warranty_start_date?: string | null;
        };
        Update: {
          archive_reason?: string | null;
          archived_at?: string | null;
          archived_by?: string | null;
          category?: Database["public"]["Enums"]["installed_equipment_category"];
          client_id?: string;
          commissioning_date?: string | null;
          created_at?: string;
          created_by?: string;
          equipment_number?: string;
          id?: string;
          installation_date?: string | null;
          location_detail?: string | null;
          manufacturer?: string | null;
          model?: string | null;
          name?: string;
          organization_id?: string;
          parent_equipment_id?: string | null;
          predecessor_equipment_id?: string | null;
          site_id?: string;
          state?: Database["public"]["Enums"]["installed_equipment_state"];
          subtype?:
            | Database["public"]["Enums"]["installed_equipment_subtype"]
            | null;
          technical_notes?: string | null;
          updated_at?: string;
          updated_by?: string;
          version?: number;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
          warranty_basis?: string | null;
          warranty_end_date?: string | null;
          warranty_provider?: string | null;
          warranty_start_date?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "installed_equipment_client_fk";
            columns: ["client_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "installed_equipment_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "installed_equipment_parent_fk";
            columns: [
              "parent_equipment_id",
              "organization_id",
              "client_id",
              "site_id",
            ];
            isOneToOne: false;
            referencedRelation: "installed_equipment";
            referencedColumns: [
              "id",
              "organization_id",
              "client_id",
              "site_id",
            ];
          },
          {
            foreignKeyName: "installed_equipment_predecessor_fk";
            columns: [
              "predecessor_equipment_id",
              "organization_id",
              "client_id",
              "site_id",
            ];
            isOneToOne: false;
            referencedRelation: "installed_equipment";
            referencedColumns: [
              "id",
              "organization_id",
              "client_id",
              "site_id",
            ];
          },
          {
            foreignKeyName: "installed_equipment_site_fk";
            columns: ["site_id", "client_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "client_sites";
            referencedColumns: ["id", "client_id", "organization_id"];
          },
        ];
      };
      installed_equipment_event_links: {
        Row: {
          created_at: string;
          document_id: string | null;
          document_storage_path: string | null;
          document_version_number: number | null;
          event_id: string;
          id: string;
          job_id: string | null;
          organization_id: string;
          project_id: string | null;
          work_artifact_revision_id: string | null;
          work_handover_release_id: string | null;
        };
        Insert: {
          created_at?: string;
          document_id?: string | null;
          document_storage_path?: string | null;
          document_version_number?: number | null;
          event_id: string;
          id?: string;
          job_id?: string | null;
          organization_id: string;
          project_id?: string | null;
          work_artifact_revision_id?: string | null;
          work_handover_release_id?: string | null;
        };
        Update: {
          created_at?: string;
          document_id?: string | null;
          document_storage_path?: string | null;
          document_version_number?: number | null;
          event_id?: string;
          id?: string;
          job_id?: string | null;
          organization_id?: string;
          project_id?: string | null;
          work_artifact_revision_id?: string | null;
          work_handover_release_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "installed_equipment_event_lin_work_artifact_revision_id_or_fkey";
            columns: ["work_artifact_revision_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "work_artifact_revisions";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "installed_equipment_event_lin_work_handover_release_id_org_fkey";
            columns: ["work_handover_release_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "work_handover_releases";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "installed_equipment_event_link_document_id_organization_id_fkey";
            columns: ["document_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "installed_equipment_event_links_event_id_organization_id_fkey";
            columns: ["event_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "installed_equipment_events";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "installed_equipment_event_links_job_id_organization_id_fkey";
            columns: ["job_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "installed_equipment_event_links_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "installed_equipment_event_links_project_id_organization_id_fkey";
            columns: ["project_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      installed_equipment_events: {
        Row: {
          actor_id: string;
          after_snapshot: Json;
          before_snapshot: Json | null;
          corrects_event_id: string | null;
          effective_at: string;
          equipment_id: string;
          event_type: Database["public"]["Enums"]["installed_equipment_event_type"];
          from_state:
            | Database["public"]["Enums"]["installed_equipment_state"]
            | null;
          id: string;
          idempotency_key: string;
          organization_id: string;
          reason: string | null;
          recorded_at: string;
          request_operation: string;
          site_snapshot: Json;
          to_state:
            | Database["public"]["Enums"]["installed_equipment_state"]
            | null;
        };
        Insert: {
          actor_id: string;
          after_snapshot: Json;
          before_snapshot?: Json | null;
          corrects_event_id?: string | null;
          effective_at: string;
          equipment_id: string;
          event_type: Database["public"]["Enums"]["installed_equipment_event_type"];
          from_state?:
            | Database["public"]["Enums"]["installed_equipment_state"]
            | null;
          id?: string;
          idempotency_key: string;
          organization_id: string;
          reason?: string | null;
          recorded_at?: string;
          request_operation: string;
          site_snapshot: Json;
          to_state?:
            | Database["public"]["Enums"]["installed_equipment_state"]
            | null;
        };
        Update: {
          actor_id?: string;
          after_snapshot?: Json;
          before_snapshot?: Json | null;
          corrects_event_id?: string | null;
          effective_at?: string;
          equipment_id?: string;
          event_type?: Database["public"]["Enums"]["installed_equipment_event_type"];
          from_state?:
            | Database["public"]["Enums"]["installed_equipment_state"]
            | null;
          id?: string;
          idempotency_key?: string;
          organization_id?: string;
          reason?: string | null;
          recorded_at?: string;
          request_operation?: string;
          site_snapshot?: Json;
          to_state?:
            | Database["public"]["Enums"]["installed_equipment_state"]
            | null;
        };
        Relationships: [
          {
            foreignKeyName: "installed_equipment_events_corrects_event_id_organization__fkey";
            columns: ["corrects_event_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "installed_equipment_events";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "installed_equipment_events_equipment_id_organization_id_fkey";
            columns: ["equipment_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "installed_equipment";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "installed_equipment_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      installed_equipment_identifiers: {
        Row: {
          created_at: string;
          created_by: string;
          equipment_id: string;
          id: string;
          identifier_type: Database["public"]["Enums"]["installed_equipment_identifier_type"];
          issuer: string | null;
          normalized_issuer: string | null;
          normalized_value: string | null;
          organization_id: string;
          value: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          equipment_id: string;
          id?: string;
          identifier_type: Database["public"]["Enums"]["installed_equipment_identifier_type"];
          issuer?: string | null;
          normalized_issuer?: string | null;
          normalized_value?: string | null;
          organization_id: string;
          value: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          equipment_id?: string;
          id?: string;
          identifier_type?: Database["public"]["Enums"]["installed_equipment_identifier_type"];
          issuer?: string | null;
          normalized_issuer?: string | null;
          normalized_value?: string | null;
          organization_id?: string;
          value?: string;
        };
        Relationships: [
          {
            foreignKeyName: "installed_equipment_identifie_equipment_id_organization_id_fkey";
            columns: ["equipment_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "installed_equipment";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "installed_equipment_identifiers_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      installed_equipment_work_links: {
        Row: {
          created_at: string;
          created_by: string;
          equipment_id: string;
          id: string;
          job_id: string | null;
          organization_id: string;
          project_id: string | null;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          equipment_id: string;
          id?: string;
          job_id?: string | null;
          organization_id: string;
          project_id?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          equipment_id?: string;
          id?: string;
          job_id?: string | null;
          organization_id?: string;
          project_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "installed_equipment_work_link_equipment_id_organization_id_fkey";
            columns: ["equipment_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "installed_equipment";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "installed_equipment_work_links_job_id_organization_id_fkey";
            columns: ["job_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "installed_equipment_work_links_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "installed_equipment_work_links_project_id_organization_id_fkey";
            columns: ["project_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      inventory_asset_instances: {
        Row: {
          asset_tag: string | null;
          assigned_to_user_id: string | null;
          created_at: string;
          current_job_id: string | null;
          current_location_id: string | null;
          id: string;
          item_id: string;
          notes: string | null;
          organization_id: string;
          purchased_at: string | null;
          serial_number: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          asset_tag?: string | null;
          assigned_to_user_id?: string | null;
          created_at?: string;
          current_job_id?: string | null;
          current_location_id?: string | null;
          id?: string;
          item_id: string;
          notes?: string | null;
          organization_id: string;
          purchased_at?: string | null;
          serial_number?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          asset_tag?: string | null;
          assigned_to_user_id?: string | null;
          created_at?: string;
          current_job_id?: string | null;
          current_location_id?: string | null;
          id?: string;
          item_id?: string;
          notes?: string | null;
          organization_id?: string;
          purchased_at?: string | null;
          serial_number?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_asset_instances_assigned_to_user_id_fkey";
            columns: ["assigned_to_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_asset_instances_current_job_id_fkey";
            columns: ["current_job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_asset_instances_current_location_id_fkey";
            columns: ["current_location_id"];
            isOneToOne: false;
            referencedRelation: "inventory_locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_asset_instances_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "inventory_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_asset_instances_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory_audit_events: {
        Row: {
          actor_id: string | null;
          created_at: string;
          event_payload: Json;
          event_type: string;
          id: string;
          item_id: string | null;
          location_id: string | null;
          organization_id: string;
        };
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          event_payload?: Json;
          event_type: string;
          id?: string;
          item_id?: string | null;
          location_id?: string | null;
          organization_id: string;
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          event_payload?: Json;
          event_type?: string;
          id?: string;
          item_id?: string | null;
          location_id?: string | null;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_audit_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_audit_events_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "inventory_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_audit_events_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "inventory_locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_audit_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory_categories: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          is_system_default: boolean;
          name: string;
          organization_id: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          is_system_default?: boolean;
          name: string;
          organization_id: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          is_system_default?: boolean;
          name?: string;
          organization_id?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_categories_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory_import_batches: {
        Row: {
          column_mapping: Json;
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          failed_count: number;
          file_name: string;
          id: string;
          imported_count: number;
          organization_id: string;
          row_count: number;
          status: string;
        };
        Insert: {
          column_mapping?: Json;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          failed_count?: number;
          file_name: string;
          id?: string;
          imported_count?: number;
          organization_id: string;
          row_count?: number;
          status?: string;
        };
        Update: {
          column_mapping?: Json;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          failed_count?: number;
          file_name?: string;
          id?: string;
          imported_count?: number;
          organization_id?: string;
          row_count?: number;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_import_batches_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_import_batches_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory_item_barcodes: {
        Row: {
          barcode_type: string;
          barcode_value: string;
          created_at: string;
          id: string;
          is_primary: boolean;
          item_id: string;
          organization_id: string;
        };
        Insert: {
          barcode_type?: string;
          barcode_value: string;
          created_at?: string;
          id?: string;
          is_primary?: boolean;
          item_id: string;
          organization_id: string;
        };
        Update: {
          barcode_type?: string;
          barcode_value?: string;
          created_at?: string;
          id?: string;
          is_primary?: boolean;
          item_id?: string;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_item_barcodes_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "inventory_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_item_barcodes_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory_items: {
        Row: {
          category_id: string | null;
          created_at: string;
          created_by: string | null;
          currency_code: string;
          description: string | null;
          global_minimum_stock: number;
          global_target_stock: number | null;
          id: string;
          internal_sku: string | null;
          is_active: boolean;
          is_billable: boolean;
          item_type: string;
          manufacturer: string | null;
          name: string;
          notes: string | null;
          organization_id: string;
          purchase_price_cents: number | null;
          sale_price_cents: number | null;
          supplier_article_number: string | null;
          supplier_id: string | null;
          tax_rate_basis_points: number;
          track_individual_assets: boolean;
          track_quantity: boolean;
          unit: string;
          updated_at: string;
        };
        Insert: {
          category_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency_code?: string;
          description?: string | null;
          global_minimum_stock?: number;
          global_target_stock?: number | null;
          id?: string;
          internal_sku?: string | null;
          is_active?: boolean;
          is_billable?: boolean;
          item_type?: string;
          manufacturer?: string | null;
          name: string;
          notes?: string | null;
          organization_id: string;
          purchase_price_cents?: number | null;
          sale_price_cents?: number | null;
          supplier_article_number?: string | null;
          supplier_id?: string | null;
          tax_rate_basis_points?: number;
          track_individual_assets?: boolean;
          track_quantity?: boolean;
          unit?: string;
          updated_at?: string;
        };
        Update: {
          category_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency_code?: string;
          description?: string | null;
          global_minimum_stock?: number;
          global_target_stock?: number | null;
          id?: string;
          internal_sku?: string | null;
          is_active?: boolean;
          is_billable?: boolean;
          item_type?: string;
          manufacturer?: string | null;
          name?: string;
          notes?: string | null;
          organization_id?: string;
          purchase_price_cents?: number | null;
          sale_price_cents?: number | null;
          supplier_article_number?: string | null;
          supplier_id?: string | null;
          tax_rate_basis_points?: number;
          track_individual_assets?: boolean;
          track_quantity?: boolean;
          unit?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_items_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "inventory_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_items_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_items_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_items_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "inventory_suppliers";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory_locations: {
        Row: {
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: string;
          is_active: boolean;
          location_type: string;
          name: string;
          organization_id: string;
          parent_location_id: string | null;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          location_type?: string;
          name: string;
          organization_id: string;
          parent_location_id?: string | null;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          location_type?: string;
          name?: string;
          organization_id?: string;
          parent_location_id?: string | null;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_locations_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_locations_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_locations_parent_location_id_fkey";
            columns: ["parent_location_id"];
            isOneToOne: false;
            referencedRelation: "inventory_locations";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory_movements: {
        Row: {
          actor_id: string | null;
          created_at: string;
          id: string;
          import_batch_id: string | null;
          item_id: string;
          job_id: string | null;
          job_material_line_id: string | null;
          location_id: string;
          movement_type: string;
          organization_id: string;
          project_id: string | null;
          quantity_after: number;
          quantity_before: number;
          quantity_delta: number;
          reason: string | null;
        };
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          id?: string;
          import_batch_id?: string | null;
          item_id: string;
          job_id?: string | null;
          job_material_line_id?: string | null;
          location_id: string;
          movement_type: string;
          organization_id: string;
          project_id?: string | null;
          quantity_after: number;
          quantity_before: number;
          quantity_delta: number;
          reason?: string | null;
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          id?: string;
          import_batch_id?: string | null;
          item_id?: string;
          job_id?: string | null;
          job_material_line_id?: string | null;
          location_id?: string;
          movement_type?: string;
          organization_id?: string;
          project_id?: string | null;
          quantity_after?: number;
          quantity_before?: number;
          quantity_delta?: number;
          reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_movements_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_import_batch_id_fkey";
            columns: ["import_batch_id"];
            isOneToOne: false;
            referencedRelation: "inventory_import_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "inventory_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_job_material_line_id_fkey";
            columns: ["job_material_line_id"];
            isOneToOne: false;
            referencedRelation: "job_material_lines";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "inventory_locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory_stock_levels: {
        Row: {
          id: string;
          item_id: string;
          location_id: string;
          organization_id: string;
          quantity_on_hand: number;
          updated_at: string;
        };
        Insert: {
          id?: string;
          item_id: string;
          location_id: string;
          organization_id: string;
          quantity_on_hand?: number;
          updated_at?: string;
        };
        Update: {
          id?: string;
          item_id?: string;
          location_id?: string;
          organization_id?: string;
          quantity_on_hand?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_stock_levels_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "inventory_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_stock_levels_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "inventory_locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_stock_levels_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory_suppliers: {
        Row: {
          created_at: string;
          customer_number: string | null;
          email: string | null;
          id: string;
          name: string;
          notes: string | null;
          organization_id: string;
          phone: string | null;
          updated_at: string;
          website: string | null;
        };
        Insert: {
          created_at?: string;
          customer_number?: string | null;
          email?: string | null;
          id?: string;
          name: string;
          notes?: string | null;
          organization_id: string;
          phone?: string | null;
          updated_at?: string;
          website?: string | null;
        };
        Update: {
          created_at?: string;
          customer_number?: string | null;
          email?: string | null;
          id?: string;
          name?: string;
          notes?: string | null;
          organization_id?: string;
          phone?: string | null;
          updated_at?: string;
          website?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_suppliers_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      job_assignments: {
        Row: {
          assigned_at: string;
          assigned_by: string;
          id: string;
          job_id: string;
          organization_id: string;
          user_id: string;
        };
        Insert: {
          assigned_at?: string;
          assigned_by: string;
          id?: string;
          job_id: string;
          organization_id: string;
          user_id: string;
        };
        Update: {
          assigned_at?: string;
          assigned_by?: string;
          id?: string;
          job_id?: string;
          organization_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_assignments_assigned_by_fkey";
            columns: ["assigned_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_assignments_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_assignments_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_assignments_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      job_capability_requirement_origins: {
        Row: {
          created_at: string;
          id: string;
          organization_id: string;
          requirement_id: string;
          source_work_template_requirement_id: string;
          work_template_application_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          organization_id: string;
          requirement_id: string;
          source_work_template_requirement_id: string;
          work_template_application_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          organization_id?: string;
          requirement_id?: string;
          source_work_template_requirement_id?: string;
          work_template_application_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_capability_requirement_or_source_work_template_require_fkey";
            columns: ["source_work_template_requirement_id"];
            isOneToOne: false;
            referencedRelation: "work_template_capability_requirements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_capability_requirement_or_work_template_application_id_fkey";
            columns: ["work_template_application_id"];
            isOneToOne: false;
            referencedRelation: "work_template_applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_capability_requirement_origins_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_capability_requirement_origins_requirement_id_fkey";
            columns: ["requirement_id"];
            isOneToOne: false;
            referencedRelation: "job_capability_requirements";
            referencedColumns: ["id"];
          },
        ];
      };
      job_capability_requirements: {
        Row: {
          capability_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          job_id: string | null;
          organization_id: string;
          project_id: string | null;
          require_confirmation: boolean;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          capability_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          job_id?: string | null;
          organization_id: string;
          project_id?: string | null;
          require_confirmation?: boolean;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          capability_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          job_id?: string | null;
          organization_id?: string;
          project_id?: string | null;
          require_confirmation?: boolean;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "job_capability_requirements_capability_id_fkey";
            columns: ["capability_id"];
            isOneToOne: false;
            referencedRelation: "organization_capabilities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_capability_requirements_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_capability_requirements_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_capability_requirements_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      job_instruction_item_dependencies: {
        Row: {
          created_at: string;
          created_by: string | null;
          dependent_item_id: string;
          id: string;
          organization_id: string;
          predecessor_item_id: string;
          source_work_template_dependency_id: string | null;
          work_template_application_id: string | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          dependent_item_id: string;
          id?: string;
          organization_id: string;
          predecessor_item_id: string;
          source_work_template_dependency_id?: string | null;
          work_template_application_id?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          dependent_item_id?: string;
          id?: string;
          organization_id?: string;
          predecessor_item_id?: string;
          source_work_template_dependency_id?: string | null;
          work_template_application_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "job_instruction_item_dependen_source_work_template_depende_fkey";
            columns: ["source_work_template_dependency_id"];
            isOneToOne: false;
            referencedRelation: "work_template_item_dependencies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_instruction_item_dependen_work_template_application_id_fkey";
            columns: ["work_template_application_id"];
            isOneToOne: false;
            referencedRelation: "work_template_applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_instruction_item_dependencies_dependent_item_id_fkey";
            columns: ["dependent_item_id"];
            isOneToOne: false;
            referencedRelation: "job_instruction_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_instruction_item_dependencies_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_instruction_item_dependencies_predecessor_item_id_fkey";
            columns: ["predecessor_item_id"];
            isOneToOne: false;
            referencedRelation: "job_instruction_items";
            referencedColumns: ["id"];
          },
        ];
      };
      job_instruction_item_events: {
        Row: {
          created_at: string;
          created_by: string | null;
          event_type: string;
          id: string;
          instruction_item_id: string;
          organization_id: string;
          previous_version: number;
          resulting_version: number;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          event_type: string;
          id?: string;
          instruction_item_id: string;
          organization_id: string;
          previous_version: number;
          resulting_version: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          event_type?: string;
          id?: string;
          instruction_item_id?: string;
          organization_id?: string;
          previous_version?: number;
          resulting_version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "job_instruction_item_events_instruction_item_id_fkey";
            columns: ["instruction_item_id"];
            isOneToOne: false;
            referencedRelation: "job_instruction_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_instruction_item_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      job_instruction_item_evidence_fulfillments: {
        Row: {
          artifact_revision_id: string | null;
          created_at: string;
          created_by: string;
          document_id: string | null;
          evidence_requirement_id: string;
          id: string;
          note: string | null;
          organization_id: string;
          removal_reason: string | null;
          removed_at: string | null;
          removed_by: string | null;
          version: number;
        };
        Insert: {
          artifact_revision_id?: string | null;
          created_at?: string;
          created_by: string;
          document_id?: string | null;
          evidence_requirement_id: string;
          id: string;
          note?: string | null;
          organization_id: string;
          removal_reason?: string | null;
          removed_at?: string | null;
          removed_by?: string | null;
          version?: number;
        };
        Update: {
          artifact_revision_id?: string | null;
          created_at?: string;
          created_by?: string;
          document_id?: string | null;
          evidence_requirement_id?: string;
          id?: string;
          note?: string | null;
          organization_id?: string;
          removal_reason?: string | null;
          removed_at?: string | null;
          removed_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "job_instruction_evidence_fulfillments_revision_fkey";
            columns: ["artifact_revision_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "work_artifact_revisions";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "job_instruction_item_evidence_fulf_evidence_requirement_id_fkey";
            columns: ["evidence_requirement_id"];
            isOneToOne: false;
            referencedRelation: "job_instruction_item_evidence_requirements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_instruction_item_evidence_fulfillments_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_instruction_item_evidence_fulfillments_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      job_instruction_item_evidence_requirements: {
        Row: {
          created_at: string;
          created_by: string | null;
          description: string;
          document_category: string;
          id: string;
          instruction_item_id: string;
          organization_id: string;
          sort_order: number;
          source_work_template_evidence_id: string | null;
          updated_at: string;
          updated_by: string | null;
          work_template_application_id: string | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          description: string;
          document_category: string;
          id?: string;
          instruction_item_id: string;
          organization_id: string;
          sort_order: number;
          source_work_template_evidence_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          work_template_application_id?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          description?: string;
          document_category?: string;
          id?: string;
          instruction_item_id?: string;
          organization_id?: string;
          sort_order?: number;
          source_work_template_evidence_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          work_template_application_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "job_instruction_item_evidence_requirem_instruction_item_id_fkey";
            columns: ["instruction_item_id"];
            isOneToOne: false;
            referencedRelation: "job_instruction_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_instruction_item_evidence_requirements_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_instruction_item_evidence_source_work_template_evidenc_fkey";
            columns: ["source_work_template_evidence_id"];
            isOneToOne: false;
            referencedRelation: "work_template_item_evidence_requirements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_instruction_item_evidence_work_template_application_id_fkey";
            columns: ["work_template_application_id"];
            isOneToOne: false;
            referencedRelation: "work_template_applications";
            referencedColumns: ["id"];
          },
        ];
      };
      job_instruction_items: {
        Row: {
          completion_version: number;
          content: string;
          created_at: string;
          created_by: string;
          group_label: string | null;
          id: string;
          is_completed: boolean;
          item_kind: string;
          job_id: string | null;
          last_status_changed_at: string | null;
          last_status_changed_by: string | null;
          notes: string | null;
          organization_id: string;
          project_id: string | null;
          requirement_state: string;
          sort_order: number;
          source_work_template_item_id: string | null;
          updated_at: string;
          work_template_application_id: string | null;
        };
        Insert: {
          completion_version?: number;
          content: string;
          created_at?: string;
          created_by: string;
          group_label?: string | null;
          id?: string;
          is_completed?: boolean;
          item_kind?: string;
          job_id?: string | null;
          last_status_changed_at?: string | null;
          last_status_changed_by?: string | null;
          notes?: string | null;
          organization_id: string;
          project_id?: string | null;
          requirement_state?: string;
          sort_order?: number;
          source_work_template_item_id?: string | null;
          updated_at?: string;
          work_template_application_id?: string | null;
        };
        Update: {
          completion_version?: number;
          content?: string;
          created_at?: string;
          created_by?: string;
          group_label?: string | null;
          id?: string;
          is_completed?: boolean;
          item_kind?: string;
          job_id?: string | null;
          last_status_changed_at?: string | null;
          last_status_changed_by?: string | null;
          notes?: string | null;
          organization_id?: string;
          project_id?: string | null;
          requirement_state?: string;
          sort_order?: number;
          source_work_template_item_id?: string | null;
          updated_at?: string;
          work_template_application_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "job_instruction_items_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_instruction_items_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_instruction_items_last_status_changed_by_fkey";
            columns: ["last_status_changed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_instruction_items_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_instruction_items_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_instruction_items_source_work_template_item_id_fkey";
            columns: ["source_work_template_item_id"];
            isOneToOne: false;
            referencedRelation: "work_template_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_instruction_items_work_template_application_id_fkey";
            columns: ["work_template_application_id"];
            isOneToOne: false;
            referencedRelation: "work_template_applications";
            referencedColumns: ["id"];
          },
        ];
      };
      job_material_lines: {
        Row: {
          billable_quantity: number;
          created_at: string;
          created_by: string | null;
          id: string;
          is_billable: boolean;
          is_unplanned: boolean;
          item_id: string;
          job_id: string | null;
          notes: string | null;
          organization_id: string;
          planned_quantity: number;
          preferred_location_id: string | null;
          project_id: string | null;
          returned_quantity: number;
          source_work_template_material_line_id: string | null;
          status: string;
          taken_quantity: number;
          updated_at: string;
          work_template_application_id: string | null;
        };
        Insert: {
          billable_quantity?: number;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_billable?: boolean;
          is_unplanned?: boolean;
          item_id: string;
          job_id?: string | null;
          notes?: string | null;
          organization_id: string;
          planned_quantity?: number;
          preferred_location_id?: string | null;
          project_id?: string | null;
          returned_quantity?: number;
          source_work_template_material_line_id?: string | null;
          status?: string;
          taken_quantity?: number;
          updated_at?: string;
          work_template_application_id?: string | null;
        };
        Update: {
          billable_quantity?: number;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_billable?: boolean;
          is_unplanned?: boolean;
          item_id?: string;
          job_id?: string | null;
          notes?: string | null;
          organization_id?: string;
          planned_quantity?: number;
          preferred_location_id?: string | null;
          project_id?: string | null;
          returned_quantity?: number;
          source_work_template_material_line_id?: string | null;
          status?: string;
          taken_quantity?: number;
          updated_at?: string;
          work_template_application_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "job_material_lines_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_material_lines_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "inventory_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_material_lines_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_material_lines_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_material_lines_preferred_location_id_fkey";
            columns: ["preferred_location_id"];
            isOneToOne: false;
            referencedRelation: "inventory_locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_material_lines_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_material_lines_source_work_template_material_line_id_fkey";
            columns: ["source_work_template_material_line_id"];
            isOneToOne: false;
            referencedRelation: "work_template_material_lines";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_material_lines_work_template_application_id_fkey";
            columns: ["work_template_application_id"];
            isOneToOne: false;
            referencedRelation: "work_template_applications";
            referencedColumns: ["id"];
          },
        ];
      };
      job_qualification_assessments: {
        Row: {
          assessed_for_date: string;
          coverage_fingerprint: string;
          coverage_snapshot: Json;
          created_at: string;
          created_by: string | null;
          id: string;
          job_id: string;
          organization_id: string;
          override_reason: string | null;
          requirements_snapshot: Json;
          selected_employee_record_ids: string[];
          selected_user_ids: string[];
          team_source_id: string | null;
        };
        Insert: {
          assessed_for_date: string;
          coverage_fingerprint: string;
          coverage_snapshot?: Json;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          job_id: string;
          organization_id: string;
          override_reason?: string | null;
          requirements_snapshot?: Json;
          selected_employee_record_ids?: string[];
          selected_user_ids?: string[];
          team_source_id?: string | null;
        };
        Update: {
          assessed_for_date?: string;
          coverage_fingerprint?: string;
          coverage_snapshot?: Json;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          job_id?: string;
          organization_id?: string;
          override_reason?: string | null;
          requirements_snapshot?: Json;
          selected_employee_record_ids?: string[];
          selected_user_ids?: string[];
          team_source_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "job_qualification_assessments_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_qualification_assessments_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_qualification_assessments_team_source_id_fkey";
            columns: ["team_source_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      jobs: {
        Row: {
          actual_completion_date: string | null;
          client_id: string | null;
          contact_id: string | null;
          created_at: string;
          created_by: string;
          description: string | null;
          estimated_duration_minutes: number | null;
          execution_state:
            | Database["public"]["Enums"]["work_execution_state"]
            | null;
          execution_version: number;
          id: string;
          job_number: string | null;
          location: string | null;
          organization_id: string;
          planned_date: string | null;
          planned_time: string | null;
          planned_working_minutes: number | null;
          priority: Database["public"]["Enums"]["job_priority"];
          project_id: string | null;
          site_id: string | null;
          status: Database["public"]["Enums"]["job_status"];
          title: string;
          updated_at: string;
        };
        Insert: {
          actual_completion_date?: string | null;
          client_id?: string | null;
          contact_id?: string | null;
          created_at?: string;
          created_by: string;
          description?: string | null;
          estimated_duration_minutes?: number | null;
          execution_state?:
            | Database["public"]["Enums"]["work_execution_state"]
            | null;
          execution_version?: number;
          id?: string;
          job_number?: string | null;
          location?: string | null;
          organization_id: string;
          planned_date?: string | null;
          planned_time?: string | null;
          planned_working_minutes?: number | null;
          priority?: Database["public"]["Enums"]["job_priority"];
          project_id?: string | null;
          site_id?: string | null;
          status?: Database["public"]["Enums"]["job_status"];
          title: string;
          updated_at?: string;
        };
        Update: {
          actual_completion_date?: string | null;
          client_id?: string | null;
          contact_id?: string | null;
          created_at?: string;
          created_by?: string;
          description?: string | null;
          estimated_duration_minutes?: number | null;
          execution_state?:
            | Database["public"]["Enums"]["work_execution_state"]
            | null;
          execution_version?: number;
          id?: string;
          job_number?: string | null;
          location?: string | null;
          organization_id?: string;
          planned_date?: string | null;
          planned_time?: string | null;
          planned_working_minutes?: number | null;
          priority?: Database["public"]["Enums"]["job_priority"];
          project_id?: string | null;
          site_id?: string | null;
          status?: Database["public"]["Enums"]["job_status"];
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "jobs_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "client_contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "client_sites";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_capabilities: {
        Row: {
          created_at: string;
          created_by: string | null;
          default_expiry_warning_days: number;
          description: string | null;
          id: string;
          kind: string;
          name: string;
          organization_id: string;
          retired_at: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          default_expiry_warning_days?: number;
          description?: string | null;
          id?: string;
          kind: string;
          name: string;
          organization_id: string;
          retired_at?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          default_expiry_warning_days?: number;
          description?: string | null;
          id?: string;
          kind?: string;
          name?: string;
          organization_id?: string;
          retired_at?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "organization_capabilities_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_closure_days: {
        Row: {
          closure_date: string;
          created_at: string;
          created_by: string | null;
          id: string;
          label: string | null;
          organization_id: string;
        };
        Insert: {
          closure_date: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          label?: string | null;
          organization_id: string;
        };
        Update: {
          closure_date?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          label?: string | null;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_closure_days_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_invites: {
        Row: {
          accepted_at: string | null;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invite_code: string;
          invited_role: Database["public"]["Enums"]["org_role"];
          organization_id: string;
          status: Database["public"]["Enums"]["invite_status"];
        };
        Insert: {
          accepted_at?: string | null;
          created_at?: string;
          email: string;
          expires_at?: string;
          id?: string;
          invite_code: string;
          invited_role?: Database["public"]["Enums"]["org_role"];
          organization_id: string;
          status?: Database["public"]["Enums"]["invite_status"];
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          invite_code?: string;
          invited_role?: Database["public"]["Enums"]["org_role"];
          organization_id?: string;
          status?: Database["public"]["Enums"]["invite_status"];
        };
        Relationships: [
          {
            foreignKeyName: "organization_invites_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_members: {
        Row: {
          id: string;
          joined_at: string;
          organization_id: string;
          role: Database["public"]["Enums"]["org_role"];
          user_id: string;
        };
        Insert: {
          id?: string;
          joined_at?: string;
          organization_id: string;
          role?: Database["public"]["Enums"]["org_role"];
          user_id: string;
        };
        Update: {
          id?: string;
          joined_at?: string;
          organization_id?: string;
          role?: Database["public"]["Enums"]["org_role"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_qualification_settings: {
        Row: {
          apprentice_warning_enabled: boolean;
          created_at: string;
          created_by: string | null;
          organization_id: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          apprentice_warning_enabled?: boolean;
          created_at?: string;
          created_by?: string | null;
          organization_id: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          apprentice_warning_enabled?: boolean;
          created_at?: string;
          created_by?: string | null;
          organization_id?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "organization_qualification_settings_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_responsibility_assignments: {
        Row: {
          configuration_id: string;
          created_at: string;
          employee_record_id: string;
          id: string;
          organization_id: string;
          role_snapshot: Database["public"]["Enums"]["org_role"] | null;
          source: Database["public"]["Enums"]["responsibility_assignment_source"];
        };
        Insert: {
          configuration_id: string;
          created_at?: string;
          employee_record_id: string;
          id?: string;
          organization_id: string;
          role_snapshot?: Database["public"]["Enums"]["org_role"] | null;
          source: Database["public"]["Enums"]["responsibility_assignment_source"];
        };
        Update: {
          configuration_id?: string;
          created_at?: string;
          employee_record_id?: string;
          id?: string;
          organization_id?: string;
          role_snapshot?: Database["public"]["Enums"]["org_role"] | null;
          source?: Database["public"]["Enums"]["responsibility_assignment_source"];
        };
        Relationships: [
          {
            foreignKeyName: "organization_responsibility_assignments_configuration_id_fkey";
            columns: ["configuration_id"];
            isOneToOne: false;
            referencedRelation: "organization_responsibility_configurations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "organization_responsibility_assignments_employee_record_id_fkey";
            columns: ["employee_record_id"];
            isOneToOne: false;
            referencedRelation: "employee_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "organization_responsibility_assignments_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_responsibility_configurations: {
        Row: {
          created_at: string;
          created_by: string | null;
          effective_from: string;
          id: string;
          mode: Database["public"]["Enums"]["responsibility_configuration_mode"];
          organization_id: string;
          responsibility: Database["public"]["Enums"]["organization_responsibility"];
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          effective_from?: string;
          id?: string;
          mode: Database["public"]["Enums"]["responsibility_configuration_mode"];
          organization_id: string;
          responsibility: Database["public"]["Enums"]["organization_responsibility"];
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          effective_from?: string;
          id?: string;
          mode?: Database["public"]["Enums"]["responsibility_configuration_mode"];
          organization_id?: string;
          responsibility?: Database["public"]["Enums"]["organization_responsibility"];
        };
        Relationships: [
          {
            foreignKeyName: "organization_responsibility_configurations_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_responsibility_delegations: {
        Row: {
          created_at: string;
          created_by: string | null;
          delegator_employee_record_id: string;
          id: string;
          note: string | null;
          organization_id: string;
          responsibility: Database["public"]["Enums"]["organization_responsibility"];
          revoked_from: string | null;
          substitute_employee_record_id: string;
          updated_at: string;
          valid_from: string;
          valid_until: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          delegator_employee_record_id: string;
          id?: string;
          note?: string | null;
          organization_id: string;
          responsibility: Database["public"]["Enums"]["organization_responsibility"];
          revoked_from?: string | null;
          substitute_employee_record_id: string;
          updated_at?: string;
          valid_from: string;
          valid_until: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          delegator_employee_record_id?: string;
          id?: string;
          note?: string | null;
          organization_id?: string;
          responsibility?: Database["public"]["Enums"]["organization_responsibility"];
          revoked_from?: string | null;
          substitute_employee_record_id?: string;
          updated_at?: string;
          valid_from?: string;
          valid_until?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_responsibility_d_delegator_employee_record_id_fkey";
            columns: ["delegator_employee_record_id"];
            isOneToOne: false;
            referencedRelation: "employee_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "organization_responsibility_d_substitute_employee_record_i_fkey";
            columns: ["substitute_employee_record_id"];
            isOneToOne: false;
            referencedRelation: "employee_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "organization_responsibility_delegations_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_responsibility_events: {
        Row: {
          configuration_id: string | null;
          created_at: string;
          created_by: string | null;
          delegation_id: string | null;
          event_payload: Json;
          event_type: string;
          id: string;
          organization_id: string;
          primary_employee_record_id: string | null;
          related_employee_record_id: string | null;
          responsibility: Database["public"]["Enums"]["organization_responsibility"];
        };
        Insert: {
          configuration_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          delegation_id?: string | null;
          event_payload?: Json;
          event_type: string;
          id?: string;
          organization_id: string;
          primary_employee_record_id?: string | null;
          related_employee_record_id?: string | null;
          responsibility: Database["public"]["Enums"]["organization_responsibility"];
        };
        Update: {
          configuration_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          delegation_id?: string | null;
          event_payload?: Json;
          event_type?: string;
          id?: string;
          organization_id?: string;
          primary_employee_record_id?: string | null;
          related_employee_record_id?: string | null;
          responsibility?: Database["public"]["Enums"]["organization_responsibility"];
        };
        Relationships: [
          {
            foreignKeyName: "organization_responsibility_eve_primary_employee_record_id_fkey";
            columns: ["primary_employee_record_id"];
            isOneToOne: false;
            referencedRelation: "employee_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "organization_responsibility_eve_related_employee_record_id_fkey";
            columns: ["related_employee_record_id"];
            isOneToOne: false;
            referencedRelation: "employee_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "organization_responsibility_events_configuration_id_fkey";
            columns: ["configuration_id"];
            isOneToOne: false;
            referencedRelation: "organization_responsibility_configurations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "organization_responsibility_events_delegation_id_fkey";
            columns: ["delegation_id"];
            isOneToOne: false;
            referencedRelation: "organization_responsibility_delegations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "organization_responsibility_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_settings: {
        Row: {
          auto_break_duration_minutes: number;
          auto_break_threshold_minutes: number;
          break_mode: Database["public"]["Enums"]["time_tracking_break_mode"];
          break_policy_history: Json;
          created_at: string;
          holiday_region: string | null;
          holiday_region_history: Json;
          organization_id: string;
          updated_at: string;
        };
        Insert: {
          auto_break_duration_minutes?: number;
          auto_break_threshold_minutes?: number;
          break_mode?: Database["public"]["Enums"]["time_tracking_break_mode"];
          break_policy_history?: Json;
          created_at?: string;
          holiday_region?: string | null;
          holiday_region_history?: Json;
          organization_id: string;
          updated_at?: string;
        };
        Update: {
          auto_break_duration_minutes?: number;
          auto_break_threshold_minutes?: number;
          break_mode?: Database["public"]["Enums"]["time_tracking_break_mode"];
          break_policy_history?: Json;
          created_at?: string;
          holiday_region?: string | null;
          holiday_region_history?: Json;
          organization_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_settings_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_user_preferences: {
        Row: {
          created_at: string;
          organization_id: string;
          preferences: Json;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          organization_id: string;
          preferences?: Json;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          organization_id?: string;
          preferences?: Json;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_user_preferences_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          admin_id: string;
          created_at: string;
          id: string;
          name: string;
          unique_code: string;
          updated_at: string;
        };
        Insert: {
          admin_id: string;
          created_at?: string;
          id?: string;
          name: string;
          unique_code: string;
          updated_at?: string;
        };
        Update: {
          admin_id?: string;
          created_at?: string;
          id?: string;
          name?: string;
          unique_code?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      planning_customer_commitment_events: {
        Row: {
          commitment_id: string;
          created_at: string;
          created_by: string | null;
          event_type: string;
          id: string;
          organization_id: string;
          payload: Json | null;
          reason: string | null;
        };
        Insert: {
          commitment_id: string;
          created_at?: string;
          created_by?: string | null;
          event_type: string;
          id?: string;
          organization_id: string;
          payload?: Json | null;
          reason?: string | null;
        };
        Update: {
          commitment_id?: string;
          created_at?: string;
          created_by?: string | null;
          event_type?: string;
          id?: string;
          organization_id?: string;
          payload?: Json | null;
          reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "planning_customer_commitment_events_commitment_id_fkey";
            columns: ["commitment_id"];
            isOneToOne: false;
            referencedRelation: "planning_customer_commitments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_customer_commitment_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      planning_customer_commitments: {
        Row: {
          committed_date: string;
          contact_id: string | null;
          id: string;
          occurrence_id: string;
          organization_id: string;
          recorded_at: string;
          recorded_by: string | null;
          source: Database["public"]["Enums"]["customer_commitment_source"];
          status: Database["public"]["Enums"]["customer_commitment_status"];
          status_changed_at: string | null;
          status_changed_by: string | null;
          supersedes_id: string | null;
          window_end_time: string | null;
          window_start_time: string | null;
          withdrawal_reason: string | null;
        };
        Insert: {
          committed_date: string;
          contact_id?: string | null;
          id?: string;
          occurrence_id: string;
          organization_id: string;
          recorded_at?: string;
          recorded_by?: string | null;
          source: Database["public"]["Enums"]["customer_commitment_source"];
          status?: Database["public"]["Enums"]["customer_commitment_status"];
          status_changed_at?: string | null;
          status_changed_by?: string | null;
          supersedes_id?: string | null;
          window_end_time?: string | null;
          window_start_time?: string | null;
          withdrawal_reason?: string | null;
        };
        Update: {
          committed_date?: string;
          contact_id?: string | null;
          id?: string;
          occurrence_id?: string;
          organization_id?: string;
          recorded_at?: string;
          recorded_by?: string | null;
          source?: Database["public"]["Enums"]["customer_commitment_source"];
          status?: Database["public"]["Enums"]["customer_commitment_status"];
          status_changed_at?: string | null;
          status_changed_by?: string | null;
          supersedes_id?: string | null;
          window_end_time?: string | null;
          window_start_time?: string | null;
          withdrawal_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "planning_customer_commitments_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "client_contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_customer_commitments_occurrence_id_fkey";
            columns: ["occurrence_id"];
            isOneToOne: false;
            referencedRelation: "planning_occurrences";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_customer_commitments_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_customer_commitments_supersedes_id_fkey";
            columns: ["supersedes_id"];
            isOneToOne: false;
            referencedRelation: "planning_customer_commitments";
            referencedColumns: ["id"];
          },
        ];
      };
      planning_dispatch_acknowledgements: {
        Row: {
          acted_by: string | null;
          carried_from_acknowledgement_id: string | null;
          challenge_resolution: string | null;
          challenge_resolution_reason: string | null;
          challenge_resolved_at: string | null;
          challenge_resolved_by: string | null;
          created_at: string;
          dispatch_id: string;
          employee_record_id: string;
          id: string;
          organization_id: string;
          reason: string | null;
          revision_id: string;
          state: Database["public"]["Enums"]["dispatch_acknowledgement_state"];
        };
        Insert: {
          acted_by?: string | null;
          carried_from_acknowledgement_id?: string | null;
          challenge_resolution?: string | null;
          challenge_resolution_reason?: string | null;
          challenge_resolved_at?: string | null;
          challenge_resolved_by?: string | null;
          created_at?: string;
          dispatch_id: string;
          employee_record_id: string;
          id?: string;
          organization_id: string;
          reason?: string | null;
          revision_id: string;
          state: Database["public"]["Enums"]["dispatch_acknowledgement_state"];
        };
        Update: {
          acted_by?: string | null;
          carried_from_acknowledgement_id?: string | null;
          challenge_resolution?: string | null;
          challenge_resolution_reason?: string | null;
          challenge_resolved_at?: string | null;
          challenge_resolved_by?: string | null;
          created_at?: string;
          dispatch_id?: string;
          employee_record_id?: string;
          id?: string;
          organization_id?: string;
          reason?: string | null;
          revision_id?: string;
          state?: Database["public"]["Enums"]["dispatch_acknowledgement_state"];
        };
        Relationships: [
          {
            foreignKeyName: "planning_dispatch_acknowledge_carried_from_acknowledgement_fkey";
            columns: ["carried_from_acknowledgement_id"];
            isOneToOne: false;
            referencedRelation: "planning_dispatch_acknowledgements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_dispatch_acknowledgements_dispatch_id_fkey";
            columns: ["dispatch_id"];
            isOneToOne: false;
            referencedRelation: "planning_dispatches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_dispatch_acknowledgements_employee_record_id_fkey";
            columns: ["employee_record_id"];
            isOneToOne: false;
            referencedRelation: "employee_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_dispatch_acknowledgements_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_dispatch_acknowledgements_revision_id_fkey";
            columns: ["revision_id"];
            isOneToOne: false;
            referencedRelation: "planning_dispatch_revisions";
            referencedColumns: ["id"];
          },
        ];
      };
      planning_dispatch_events: {
        Row: {
          created_at: string;
          created_by: string | null;
          dispatch_id: string;
          event_type: string;
          id: string;
          organization_id: string;
          payload: Json | null;
          reason: string | null;
          revision_id: string | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          dispatch_id: string;
          event_type: string;
          id?: string;
          organization_id: string;
          payload?: Json | null;
          reason?: string | null;
          revision_id?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          dispatch_id?: string;
          event_type?: string;
          id?: string;
          organization_id?: string;
          payload?: Json | null;
          reason?: string | null;
          revision_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "planning_dispatch_events_dispatch_id_fkey";
            columns: ["dispatch_id"];
            isOneToOne: false;
            referencedRelation: "planning_dispatches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_dispatch_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_dispatch_events_revision_id_fkey";
            columns: ["revision_id"];
            isOneToOne: false;
            referencedRelation: "planning_dispatch_revisions";
            referencedColumns: ["id"];
          },
        ];
      };
      planning_dispatch_recipients: {
        Row: {
          created_at: string;
          dispatch_id: string;
          employee_record_id: string;
          id: string;
          organization_id: string;
          revision_id: string;
        };
        Insert: {
          created_at?: string;
          dispatch_id: string;
          employee_record_id: string;
          id?: string;
          organization_id: string;
          revision_id: string;
        };
        Update: {
          created_at?: string;
          dispatch_id?: string;
          employee_record_id?: string;
          id?: string;
          organization_id?: string;
          revision_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "planning_dispatch_recipients_dispatch_id_fkey";
            columns: ["dispatch_id"];
            isOneToOne: false;
            referencedRelation: "planning_dispatches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_dispatch_recipients_employee_record_id_fkey";
            columns: ["employee_record_id"];
            isOneToOne: false;
            referencedRelation: "employee_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_dispatch_recipients_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_dispatch_recipients_revision_id_fkey";
            columns: ["revision_id"];
            isOneToOne: false;
            referencedRelation: "planning_dispatch_revisions";
            referencedColumns: ["id"];
          },
        ];
      };
      planning_dispatch_revisions: {
        Row: {
          change_kind: Database["public"]["Enums"]["dispatch_change_kind"];
          created_at: string;
          created_by: string | null;
          dispatch_id: string;
          dispatch_note: string | null;
          id: string;
          job_id: string | null;
          location_text: string | null;
          material_fingerprint: string;
          occurrence_id: string | null;
          organization_id: string;
          planned_end_at: string | null;
          planned_end_date_exclusive: string | null;
          planned_start_at: string | null;
          planned_start_date: string | null;
          readiness_fingerprint: string | null;
          readiness_snapshot: Json | null;
          revision_number: number;
          site_id: string | null;
        };
        Insert: {
          change_kind: Database["public"]["Enums"]["dispatch_change_kind"];
          created_at?: string;
          created_by?: string | null;
          dispatch_id: string;
          dispatch_note?: string | null;
          id?: string;
          job_id?: string | null;
          location_text?: string | null;
          material_fingerprint: string;
          occurrence_id?: string | null;
          organization_id: string;
          planned_end_at?: string | null;
          planned_end_date_exclusive?: string | null;
          planned_start_at?: string | null;
          planned_start_date?: string | null;
          readiness_fingerprint?: string | null;
          readiness_snapshot?: Json | null;
          revision_number: number;
          site_id?: string | null;
        };
        Update: {
          change_kind?: Database["public"]["Enums"]["dispatch_change_kind"];
          created_at?: string;
          created_by?: string | null;
          dispatch_id?: string;
          dispatch_note?: string | null;
          id?: string;
          job_id?: string | null;
          location_text?: string | null;
          material_fingerprint?: string;
          occurrence_id?: string | null;
          organization_id?: string;
          planned_end_at?: string | null;
          planned_end_date_exclusive?: string | null;
          planned_start_at?: string | null;
          planned_start_date?: string | null;
          readiness_fingerprint?: string | null;
          readiness_snapshot?: Json | null;
          revision_number?: number;
          site_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "planning_dispatch_revisions_dispatch_id_fkey";
            columns: ["dispatch_id"];
            isOneToOne: false;
            referencedRelation: "planning_dispatches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_dispatch_revisions_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_dispatch_revisions_occurrence_id_fkey";
            columns: ["occurrence_id"];
            isOneToOne: false;
            referencedRelation: "planning_occurrences";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_dispatch_revisions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_dispatch_revisions_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "client_sites";
            referencedColumns: ["id"];
          },
        ];
      };
      planning_dispatches: {
        Row: {
          created_at: string;
          created_by: string | null;
          creation_request_id: string | null;
          current_revision_id: string | null;
          id: string;
          job_id: string | null;
          occurrence_id: string | null;
          organization_id: string;
          status: Database["public"]["Enums"]["dispatch_status"];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          creation_request_id?: string | null;
          current_revision_id?: string | null;
          id?: string;
          job_id?: string | null;
          occurrence_id?: string | null;
          organization_id: string;
          status?: Database["public"]["Enums"]["dispatch_status"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          creation_request_id?: string | null;
          current_revision_id?: string | null;
          id?: string;
          job_id?: string | null;
          occurrence_id?: string | null;
          organization_id?: string;
          status?: Database["public"]["Enums"]["dispatch_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "planning_dispatches_current_revision_fkey";
            columns: ["current_revision_id"];
            isOneToOne: false;
            referencedRelation: "planning_dispatch_revisions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_dispatches_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_dispatches_occurrence_id_fkey";
            columns: ["occurrence_id"];
            isOneToOne: false;
            referencedRelation: "planning_occurrences";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_dispatches_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      planning_events: {
        Row: {
          after_state: Json | null;
          before_state: Json | null;
          created_at: string;
          created_by: string | null;
          event_type: string;
          id: string;
          mutation_scope: string;
          occurrence_id: string | null;
          organization_id: string;
          reason: string | null;
          series_id: string | null;
        };
        Insert: {
          after_state?: Json | null;
          before_state?: Json | null;
          created_at?: string;
          created_by?: string | null;
          event_type: string;
          id?: string;
          mutation_scope: string;
          occurrence_id?: string | null;
          organization_id: string;
          reason?: string | null;
          series_id?: string | null;
        };
        Update: {
          after_state?: Json | null;
          before_state?: Json | null;
          created_at?: string;
          created_by?: string | null;
          event_type?: string;
          id?: string;
          mutation_scope?: string;
          occurrence_id?: string | null;
          organization_id?: string;
          reason?: string | null;
          series_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "planning_events_occurrence_id_fkey";
            columns: ["occurrence_id"];
            isOneToOne: false;
            referencedRelation: "planning_occurrences";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_events_series_id_fkey";
            columns: ["series_id"];
            isOneToOne: false;
            referencedRelation: "planning_series";
            referencedColumns: ["id"];
          },
        ];
      };
      planning_occurrence_assessments: {
        Row: {
          capacity_fingerprint: string;
          capacity_snapshot: Json;
          created_at: string;
          created_by: string | null;
          id: string;
          occurrence_id: string;
          organization_id: string;
          override_reason: string | null;
          qualification_fingerprint: string;
          qualification_snapshot: Json;
          selected_employee_record_ids: string[];
          team_source_ids: string[];
        };
        Insert: {
          capacity_fingerprint: string;
          capacity_snapshot?: Json;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          occurrence_id: string;
          organization_id: string;
          override_reason?: string | null;
          qualification_fingerprint: string;
          qualification_snapshot?: Json;
          selected_employee_record_ids?: string[];
          team_source_ids?: string[];
        };
        Update: {
          capacity_fingerprint?: string;
          capacity_snapshot?: Json;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          occurrence_id?: string;
          organization_id?: string;
          override_reason?: string | null;
          qualification_fingerprint?: string;
          qualification_snapshot?: Json;
          selected_employee_record_ids?: string[];
          team_source_ids?: string[];
        };
        Relationships: [
          {
            foreignKeyName: "planning_occurrence_assessments_occurrence_id_fkey";
            columns: ["occurrence_id"];
            isOneToOne: false;
            referencedRelation: "planning_occurrences";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_occurrence_assessments_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      planning_occurrence_assignments: {
        Row: {
          assigned_at: string;
          assigned_by: string | null;
          employee_record_id: string;
          id: string;
          occurrence_id: string;
          organization_id: string;
          team_source_id: string | null;
        };
        Insert: {
          assigned_at?: string;
          assigned_by?: string | null;
          employee_record_id: string;
          id?: string;
          occurrence_id: string;
          organization_id: string;
          team_source_id?: string | null;
        };
        Update: {
          assigned_at?: string;
          assigned_by?: string | null;
          employee_record_id?: string;
          id?: string;
          occurrence_id?: string;
          organization_id?: string;
          team_source_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "planning_occurrence_assignments_employee_record_id_fkey";
            columns: ["employee_record_id"];
            isOneToOne: false;
            referencedRelation: "employee_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_occurrence_assignments_occurrence_id_fkey";
            columns: ["occurrence_id"];
            isOneToOne: false;
            referencedRelation: "planning_occurrences";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_occurrence_assignments_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_occurrence_assignments_team_source_id_fkey";
            columns: ["team_source_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      planning_occurrences: {
        Row: {
          created_at: string;
          created_by: string | null;
          creation_request_id: string | null;
          description: string | null;
          dst_resolution: string;
          end_at: string | null;
          end_date_exclusive: string | null;
          entry_kind: Database["public"]["Enums"]["planning_entry_kind"];
          id: string;
          internal_type:
            | Database["public"]["Enums"]["planning_internal_type"]
            | null;
          is_exception: boolean;
          job_id: string | null;
          legacy_source_job_id: string | null;
          location: string | null;
          organization_id: string;
          original_start_local: string | null;
          series_id: string | null;
          series_lineage_id: string | null;
          start_at: string | null;
          start_date: string | null;
          status: Database["public"]["Enums"]["planning_occurrence_status"];
          time_kind: Database["public"]["Enums"]["planning_time_kind"];
          timezone: string;
          title: string | null;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          creation_request_id?: string | null;
          description?: string | null;
          dst_resolution?: string;
          end_at?: string | null;
          end_date_exclusive?: string | null;
          entry_kind: Database["public"]["Enums"]["planning_entry_kind"];
          id?: string;
          internal_type?:
            | Database["public"]["Enums"]["planning_internal_type"]
            | null;
          is_exception?: boolean;
          job_id?: string | null;
          legacy_source_job_id?: string | null;
          location?: string | null;
          organization_id: string;
          original_start_local?: string | null;
          series_id?: string | null;
          series_lineage_id?: string | null;
          start_at?: string | null;
          start_date?: string | null;
          status?: Database["public"]["Enums"]["planning_occurrence_status"];
          time_kind: Database["public"]["Enums"]["planning_time_kind"];
          timezone?: string;
          title?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          creation_request_id?: string | null;
          description?: string | null;
          dst_resolution?: string;
          end_at?: string | null;
          end_date_exclusive?: string | null;
          entry_kind?: Database["public"]["Enums"]["planning_entry_kind"];
          id?: string;
          internal_type?:
            | Database["public"]["Enums"]["planning_internal_type"]
            | null;
          is_exception?: boolean;
          job_id?: string | null;
          legacy_source_job_id?: string | null;
          location?: string | null;
          organization_id?: string;
          original_start_local?: string | null;
          series_id?: string | null;
          series_lineage_id?: string | null;
          start_at?: string | null;
          start_date?: string | null;
          status?: Database["public"]["Enums"]["planning_occurrence_status"];
          time_kind?: Database["public"]["Enums"]["planning_time_kind"];
          timezone?: string;
          title?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "planning_occurrences_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_occurrences_legacy_source_job_id_fkey";
            columns: ["legacy_source_job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_occurrences_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_occurrences_series_id_fkey";
            columns: ["series_id"];
            isOneToOne: false;
            referencedRelation: "planning_series";
            referencedColumns: ["id"];
          },
        ];
      };
      planning_series: {
        Row: {
          created_at: string;
          created_by: string | null;
          creation_request_id: string | null;
          description: string | null;
          duration_days: number | null;
          duration_minutes: number | null;
          entry_kind: Database["public"]["Enums"]["planning_entry_kind"];
          generated_through_local: string | null;
          id: string;
          internal_type:
            | Database["public"]["Enums"]["planning_internal_type"]
            | null;
          job_id: string | null;
          lineage_id: string;
          location: string | null;
          month_day: number | null;
          occurrence_count: number | null;
          organization_id: string;
          previous_series_id: string | null;
          recurrence_frequency: string;
          recurrence_interval: number;
          segment_end_before_local: string | null;
          segment_start_local: string;
          starts_at_local: string;
          time_kind: Database["public"]["Enums"]["planning_time_kind"];
          timezone: string;
          title: string | null;
          until_local_date: string | null;
          updated_at: string;
          updated_by: string | null;
          weekdays: number[] | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          creation_request_id?: string | null;
          description?: string | null;
          duration_days?: number | null;
          duration_minutes?: number | null;
          entry_kind: Database["public"]["Enums"]["planning_entry_kind"];
          generated_through_local?: string | null;
          id?: string;
          internal_type?:
            | Database["public"]["Enums"]["planning_internal_type"]
            | null;
          job_id?: string | null;
          lineage_id?: string;
          location?: string | null;
          month_day?: number | null;
          occurrence_count?: number | null;
          organization_id: string;
          previous_series_id?: string | null;
          recurrence_frequency: string;
          recurrence_interval?: number;
          segment_end_before_local?: string | null;
          segment_start_local: string;
          starts_at_local: string;
          time_kind: Database["public"]["Enums"]["planning_time_kind"];
          timezone?: string;
          title?: string | null;
          until_local_date?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          weekdays?: number[] | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          creation_request_id?: string | null;
          description?: string | null;
          duration_days?: number | null;
          duration_minutes?: number | null;
          entry_kind?: Database["public"]["Enums"]["planning_entry_kind"];
          generated_through_local?: string | null;
          id?: string;
          internal_type?:
            | Database["public"]["Enums"]["planning_internal_type"]
            | null;
          job_id?: string | null;
          lineage_id?: string;
          location?: string | null;
          month_day?: number | null;
          occurrence_count?: number | null;
          organization_id?: string;
          previous_series_id?: string | null;
          recurrence_frequency?: string;
          recurrence_interval?: number;
          segment_end_before_local?: string | null;
          segment_start_local?: string;
          starts_at_local?: string;
          time_kind?: Database["public"]["Enums"]["planning_time_kind"];
          timezone?: string;
          title?: string | null;
          until_local_date?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          weekdays?: number[] | null;
        };
        Relationships: [
          {
            foreignKeyName: "planning_series_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_series_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planning_series_previous_series_id_fkey";
            columns: ["previous_series_id"];
            isOneToOne: false;
            referencedRelation: "planning_series";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_path: string | null;
          created_at: string;
          email: string | null;
          first_name: string | null;
          id: string;
          last_name: string | null;
          updated_at: string | null;
        };
        Insert: {
          avatar_path?: string | null;
          created_at?: string;
          email?: string | null;
          first_name?: string | null;
          id: string;
          last_name?: string | null;
          updated_at?: string | null;
        };
        Update: {
          avatar_path?: string | null;
          created_at?: string;
          email?: string | null;
          first_name?: string | null;
          id?: string;
          last_name?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      projects: {
        Row: {
          client_id: string | null;
          contact_id: string | null;
          created_at: string;
          created_by: string;
          description: string | null;
          execution_override_reason: string | null;
          execution_state_override:
            | Database["public"]["Enums"]["work_execution_state"]
            | null;
          execution_version: number;
          id: string;
          name: string;
          organization_id: string;
          planned_end_date: string | null;
          planned_start_date: string | null;
          project_number: string | null;
          site_id: string | null;
          status_override: Database["public"]["Enums"]["project_status"] | null;
          updated_at: string;
        };
        Insert: {
          client_id?: string | null;
          contact_id?: string | null;
          created_at?: string;
          created_by: string;
          description?: string | null;
          execution_override_reason?: string | null;
          execution_state_override?:
            | Database["public"]["Enums"]["work_execution_state"]
            | null;
          execution_version?: number;
          id?: string;
          name: string;
          organization_id: string;
          planned_end_date?: string | null;
          planned_start_date?: string | null;
          project_number?: string | null;
          site_id?: string | null;
          status_override?:
            | Database["public"]["Enums"]["project_status"]
            | null;
          updated_at?: string;
        };
        Update: {
          client_id?: string | null;
          contact_id?: string | null;
          created_at?: string;
          created_by?: string;
          description?: string | null;
          execution_override_reason?: string | null;
          execution_state_override?:
            | Database["public"]["Enums"]["work_execution_state"]
            | null;
          execution_version?: number;
          id?: string;
          name?: string;
          organization_id?: string;
          planned_end_date?: string | null;
          planned_start_date?: string | null;
          project_number?: string | null;
          site_id?: string | null;
          status_override?:
            | Database["public"]["Enums"]["project_status"]
            | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "projects_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "client_contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "projects_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "projects_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "projects_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "client_sites";
            referencedColumns: ["id"];
          },
        ];
      };
      qualification_events: {
        Row: {
          capability_id: string | null;
          created_at: string;
          created_by: string | null;
          event_payload: Json;
          event_type: string;
          id: string;
          organization_id: string;
        };
        Insert: {
          capability_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          event_payload?: Json;
          event_type: string;
          id?: string;
          organization_id: string;
        };
        Update: {
          capability_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          event_payload?: Json;
          event_type?: string;
          id?: string;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "qualification_events_capability_id_fkey";
            columns: ["capability_id"];
            isOneToOne: false;
            referencedRelation: "organization_capabilities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "qualification_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      service_case_equipment_links: {
        Row: {
          created_at: string;
          created_by: string;
          equipment_id: string;
          id: string;
          organization_id: string;
          service_case_id: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          equipment_id: string;
          id?: string;
          organization_id: string;
          service_case_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          equipment_id?: string;
          id?: string;
          organization_id?: string;
          service_case_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_case_equipment_links_equipment_id_organization_id_fkey";
            columns: ["equipment_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "installed_equipment";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "service_case_equipment_links_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_case_equipment_links_service_case_id_organization__fkey";
            columns: ["service_case_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "service_cases";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      service_case_events: {
        Row: {
          actor_id: string;
          after_snapshot: Json;
          before_snapshot: Json | null;
          event_type: Database["public"]["Enums"]["service_case_event_type"];
          id: string;
          idempotency_key: string;
          organization_id: string;
          reason: string | null;
          recorded_at: string;
          request_operation: string;
          request_payload: Json;
          service_case_id: string;
        };
        Insert: {
          actor_id: string;
          after_snapshot: Json;
          before_snapshot?: Json | null;
          event_type: Database["public"]["Enums"]["service_case_event_type"];
          id?: string;
          idempotency_key: string;
          organization_id: string;
          reason?: string | null;
          recorded_at?: string;
          request_operation: string;
          request_payload: Json;
          service_case_id: string;
        };
        Update: {
          actor_id?: string;
          after_snapshot?: Json;
          before_snapshot?: Json | null;
          event_type?: Database["public"]["Enums"]["service_case_event_type"];
          id?: string;
          idempotency_key?: string;
          organization_id?: string;
          reason?: string | null;
          recorded_at?: string;
          request_operation?: string;
          request_payload?: Json;
          service_case_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_case_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_case_events_service_case_id_organization_id_fkey";
            columns: ["service_case_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "service_cases";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      service_case_evidence_links: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          organization_id: string;
          service_case_id: string;
          work_artifact_revision_id: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          id?: string;
          organization_id: string;
          service_case_id: string;
          work_artifact_revision_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          organization_id?: string;
          service_case_id?: string;
          work_artifact_revision_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_case_evidence_links_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_case_evidence_links_service_case_id_organization_i_fkey";
            columns: ["service_case_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "service_cases";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "service_case_evidence_links_work_artifact_revision_id_orga_fkey";
            columns: ["work_artifact_revision_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "work_artifact_revisions";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      service_case_relations: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          organization_id: string;
          reason: string;
          related_service_case_id: string;
          relation_type: Database["public"]["Enums"]["service_case_relation_type"];
          service_case_id: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          id?: string;
          organization_id: string;
          reason: string;
          related_service_case_id: string;
          relation_type: Database["public"]["Enums"]["service_case_relation_type"];
          service_case_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          organization_id?: string;
          reason?: string;
          related_service_case_id?: string;
          relation_type?: Database["public"]["Enums"]["service_case_relation_type"];
          service_case_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_case_relations_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_case_relations_related_service_case_id_organizatio_fkey";
            columns: ["related_service_case_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "service_cases";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "service_case_relations_service_case_id_organization_id_fkey";
            columns: ["service_case_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "service_cases";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      service_cases: {
        Row: {
          access_instructions: string | null;
          case_number: string;
          charge_context: Database["public"]["Enums"]["service_case_charge_context"];
          client_id: string;
          contact_id: string | null;
          created_at: string;
          created_by: string;
          id: string;
          intake_type: Database["public"]["Enums"]["service_case_intake_type"];
          job_id: string | null;
          organization_id: string;
          original_details: string | null;
          original_statement: string;
          resolution_note: string | null;
          site_id: string;
          source_request_id: string | null;
          status: Database["public"]["Enums"]["service_case_status"];
          summary: string;
          triage_note: string | null;
          updated_at: string;
          updated_by: string;
          urgency: Database["public"]["Enums"]["request_urgency"];
          version: number;
        };
        Insert: {
          access_instructions?: string | null;
          case_number: string;
          charge_context?: Database["public"]["Enums"]["service_case_charge_context"];
          client_id: string;
          contact_id?: string | null;
          created_at?: string;
          created_by: string;
          id: string;
          intake_type: Database["public"]["Enums"]["service_case_intake_type"];
          job_id?: string | null;
          organization_id: string;
          original_details?: string | null;
          original_statement: string;
          resolution_note?: string | null;
          site_id: string;
          source_request_id?: string | null;
          status?: Database["public"]["Enums"]["service_case_status"];
          summary: string;
          triage_note?: string | null;
          updated_at?: string;
          updated_by: string;
          urgency?: Database["public"]["Enums"]["request_urgency"];
          version?: number;
        };
        Update: {
          access_instructions?: string | null;
          case_number?: string;
          charge_context?: Database["public"]["Enums"]["service_case_charge_context"];
          client_id?: string;
          contact_id?: string | null;
          created_at?: string;
          created_by?: string;
          id?: string;
          intake_type?: Database["public"]["Enums"]["service_case_intake_type"];
          job_id?: string | null;
          organization_id?: string;
          original_details?: string | null;
          original_statement?: string;
          resolution_note?: string | null;
          site_id?: string;
          source_request_id?: string | null;
          status?: Database["public"]["Enums"]["service_case_status"];
          summary?: string;
          triage_note?: string | null;
          updated_at?: string;
          updated_by?: string;
          urgency?: Database["public"]["Enums"]["request_urgency"];
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "service_cases_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_cases_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "client_contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_cases_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_cases_job_id_organization_id_fkey";
            columns: ["job_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "service_cases_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_cases_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "client_sites";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_cases_source_request_id_fkey";
            columns: ["source_request_id"];
            isOneToOne: false;
            referencedRelation: "client_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      sickness_report_events: {
        Row: {
          created_at: string;
          created_by: string | null;
          employee_record_id: string;
          event_payload: Json;
          event_type: string;
          id: string;
          organization_id: string;
          sickness_report_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          employee_record_id: string;
          event_payload?: Json;
          event_type: string;
          id?: string;
          organization_id: string;
          sickness_report_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          employee_record_id?: string;
          event_payload?: Json;
          event_type?: string;
          id?: string;
          organization_id?: string;
          sickness_report_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sickness_report_events_employee_record_id_fkey";
            columns: ["employee_record_id"];
            isOneToOne: false;
            referencedRelation: "employee_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sickness_report_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sickness_report_events_sickness_report_id_fkey";
            columns: ["sickness_report_id"];
            isOneToOne: false;
            referencedRelation: "sickness_reports";
            referencedColumns: ["id"];
          },
        ];
      };
      sickness_reports: {
        Row: {
          absence_type: string;
          cancellation_reason: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          created_at: string;
          day_portion: string;
          employee_record_id: string;
          end_date: string | null;
          evidence_required: boolean;
          evidence_status: string;
          id: string;
          organization_id: string;
          reported_by: string | null;
          start_date: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          absence_type?: string;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          created_at?: string;
          day_portion?: string;
          employee_record_id: string;
          end_date?: string | null;
          evidence_required?: boolean;
          evidence_status?: string;
          id?: string;
          organization_id: string;
          reported_by?: string | null;
          start_date: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          absence_type?: string;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          created_at?: string;
          day_portion?: string;
          employee_record_id?: string;
          end_date?: string | null;
          evidence_required?: boolean;
          evidence_status?: string;
          id?: string;
          organization_id?: string;
          reported_by?: string | null;
          start_date?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sickness_reports_employee_record_id_fkey";
            columns: ["employee_record_id"];
            isOneToOne: false;
            referencedRelation: "employee_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sickness_reports_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      subscriptions: {
        Row: {
          created_at: string;
          id: string;
          plan_id: string | null;
          status: Database["public"]["Enums"]["subscription_status"];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          plan_id?: string | null;
          status?: Database["public"]["Enums"]["subscription_status"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          plan_id?: string | null;
          status?: Database["public"]["Enums"]["subscription_status"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      team_events: {
        Row: {
          created_at: string;
          created_by: string | null;
          event_payload: Json;
          event_type: string;
          id: string;
          organization_id: string;
          team_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          event_payload?: Json;
          event_type: string;
          id?: string;
          organization_id: string;
          team_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          event_payload?: Json;
          event_type?: string;
          id?: string;
          organization_id?: string;
          team_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "team_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "team_events_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      team_memberships: {
        Row: {
          created_at: string;
          created_by: string | null;
          employee_record_id: string;
          ended_by: string | null;
          id: string;
          organization_id: string;
          team_id: string;
          updated_at: string;
          valid_from: string;
          valid_until: string | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          employee_record_id: string;
          ended_by?: string | null;
          id?: string;
          organization_id: string;
          team_id: string;
          updated_at?: string;
          valid_from: string;
          valid_until?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          employee_record_id?: string;
          ended_by?: string | null;
          id?: string;
          organization_id?: string;
          team_id?: string;
          updated_at?: string;
          valid_from?: string;
          valid_until?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "team_memberships_employee_record_id_fkey";
            columns: ["employee_record_id"];
            isOneToOne: false;
            referencedRelation: "employee_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "team_memberships_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "team_memberships_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      teams: {
        Row: {
          created_at: string;
          created_by: string | null;
          description: string | null;
          dissolved_at: string | null;
          id: string;
          name: string;
          organization_id: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          dissolved_at?: string | null;
          id?: string;
          name: string;
          organization_id: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          dissolved_at?: string | null;
          id?: string;
          name?: string;
          organization_id?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "teams_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      time_entries: {
        Row: {
          created_at: string;
          entry_type: string;
          id: string;
          is_manual: boolean;
          job_id: string | null;
          organization_id: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: Database["public"]["Enums"]["time_entry_status"];
          timestamp: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          entry_type: string;
          id?: string;
          is_manual?: boolean;
          job_id?: string | null;
          organization_id: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database["public"]["Enums"]["time_entry_status"];
          timestamp: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          entry_type?: string;
          id?: string;
          is_manual?: boolean;
          job_id?: string | null;
          organization_id?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database["public"]["Enums"]["time_entry_status"];
          timestamp?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "time_entries_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_entries_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      vacation_request_events: {
        Row: {
          created_at: string;
          created_by: string | null;
          employee_record_id: string;
          event_payload: Json;
          event_type: string;
          id: string;
          organization_id: string;
          vacation_request_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          employee_record_id: string;
          event_payload?: Json;
          event_type: string;
          id?: string;
          organization_id: string;
          vacation_request_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          employee_record_id?: string;
          event_payload?: Json;
          event_type?: string;
          id?: string;
          organization_id?: string;
          vacation_request_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vacation_request_events_employee_record_id_fkey";
            columns: ["employee_record_id"];
            isOneToOne: false;
            referencedRelation: "employee_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vacation_request_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vacation_request_events_vacation_request_id_fkey";
            columns: ["vacation_request_id"];
            isOneToOne: false;
            referencedRelation: "vacation_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      vacation_requests: {
        Row: {
          approved_days_by_year: Json | null;
          cancellation_reason: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          comment: string | null;
          created_at: string;
          day_portion: string;
          decided_at: string | null;
          decided_by: string | null;
          decision_comment: string | null;
          employee_record_id: string;
          end_date: string;
          id: string;
          organization_id: string;
          requested_by: string | null;
          start_date: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          approved_days_by_year?: Json | null;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          comment?: string | null;
          created_at?: string;
          day_portion?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_comment?: string | null;
          employee_record_id: string;
          end_date: string;
          id?: string;
          organization_id: string;
          requested_by?: string | null;
          start_date: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          approved_days_by_year?: Json | null;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          comment?: string | null;
          created_at?: string;
          day_portion?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_comment?: string | null;
          employee_record_id?: string;
          end_date?: string;
          id?: string;
          organization_id?: string;
          requested_by?: string | null;
          start_date?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vacation_requests_employee_record_id_fkey";
            columns: ["employee_record_id"];
            isOneToOne: false;
            referencedRelation: "employee_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vacation_requests_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      work_artifact_actions: {
        Row: {
          action_type: Database["public"]["Enums"]["work_artifact_action_type"];
          artifact_id: string;
          capture_method: string | null;
          comment: string | null;
          created_at: string;
          created_by: string;
          id: string;
          organization_id: string;
          reason: string | null;
          responsibility_snapshot: Json | null;
          revision_id: string;
          signature_document_id: string | null;
          signer_company_context: string | null;
          signer_name: string | null;
          signer_relationship: string | null;
          signer_role: string | null;
          witness_context: string | null;
          wording_snapshot: string | null;
        };
        Insert: {
          action_type: Database["public"]["Enums"]["work_artifact_action_type"];
          artifact_id: string;
          capture_method?: string | null;
          comment?: string | null;
          created_at?: string;
          created_by: string;
          id: string;
          organization_id: string;
          reason?: string | null;
          responsibility_snapshot?: Json | null;
          revision_id: string;
          signature_document_id?: string | null;
          signer_company_context?: string | null;
          signer_name?: string | null;
          signer_relationship?: string | null;
          signer_role?: string | null;
          witness_context?: string | null;
          wording_snapshot?: string | null;
        };
        Update: {
          action_type?: Database["public"]["Enums"]["work_artifact_action_type"];
          artifact_id?: string;
          capture_method?: string | null;
          comment?: string | null;
          created_at?: string;
          created_by?: string;
          id?: string;
          organization_id?: string;
          reason?: string | null;
          responsibility_snapshot?: Json | null;
          revision_id?: string;
          signature_document_id?: string | null;
          signer_company_context?: string | null;
          signer_name?: string | null;
          signer_relationship?: string | null;
          signer_role?: string | null;
          witness_context?: string | null;
          wording_snapshot?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "work_artifact_actions_artifact_fkey";
            columns: ["artifact_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "work_artifacts";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "work_artifact_actions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_artifact_actions_revision_fkey";
            columns: ["revision_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "work_artifact_revisions";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "work_artifact_actions_signature_document_id_fkey";
            columns: ["signature_document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      work_artifact_change_details: {
        Row: {
          actual_labor_minutes: number | null;
          actual_material_summary: string | null;
          authorization_state: Database["public"]["Enums"]["work_artifact_change_authorization_state"];
          change_description: string;
          change_reason: string;
          expected_labor_minutes: number | null;
          expected_material_summary: string | null;
          organization_id: string;
          requested_by_context: string;
          revision_id: string;
          schedule_impact: string | null;
        };
        Insert: {
          actual_labor_minutes?: number | null;
          actual_material_summary?: string | null;
          authorization_state?: Database["public"]["Enums"]["work_artifact_change_authorization_state"];
          change_description: string;
          change_reason: string;
          expected_labor_minutes?: number | null;
          expected_material_summary?: string | null;
          organization_id: string;
          requested_by_context: string;
          revision_id: string;
          schedule_impact?: string | null;
        };
        Update: {
          actual_labor_minutes?: number | null;
          actual_material_summary?: string | null;
          authorization_state?: Database["public"]["Enums"]["work_artifact_change_authorization_state"];
          change_description?: string;
          change_reason?: string;
          expected_labor_minutes?: number | null;
          expected_material_summary?: string | null;
          organization_id?: string;
          requested_by_context?: string;
          revision_id?: string;
          schedule_impact?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "work_artifact_change_details_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_artifact_change_details_revision_fkey";
            columns: ["revision_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "work_artifact_revisions";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      work_artifact_defect_details: {
        Row: {
          description: string;
          due_date: string | null;
          location: string;
          organization_id: string;
          proposed_resolution: string | null;
          resolution_summary: string | null;
          responsibility_context: string | null;
          responsible_employee_record_id: string | null;
          revision_id: string;
          severity: Database["public"]["Enums"]["work_artifact_defect_severity"];
          state: Database["public"]["Enums"]["work_artifact_defect_state"];
        };
        Insert: {
          description: string;
          due_date?: string | null;
          location: string;
          organization_id: string;
          proposed_resolution?: string | null;
          resolution_summary?: string | null;
          responsibility_context?: string | null;
          responsible_employee_record_id?: string | null;
          revision_id: string;
          severity: Database["public"]["Enums"]["work_artifact_defect_severity"];
          state?: Database["public"]["Enums"]["work_artifact_defect_state"];
        };
        Update: {
          description?: string;
          due_date?: string | null;
          location?: string;
          organization_id?: string;
          proposed_resolution?: string | null;
          resolution_summary?: string | null;
          responsibility_context?: string | null;
          responsible_employee_record_id?: string | null;
          revision_id?: string;
          severity?: Database["public"]["Enums"]["work_artifact_defect_severity"];
          state?: Database["public"]["Enums"]["work_artifact_defect_state"];
        };
        Relationships: [
          {
            foreignKeyName: "work_artifact_defect_details_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_artifact_defect_details_responsible_employee_record_i_fkey";
            columns: ["responsible_employee_record_id"];
            isOneToOne: false;
            referencedRelation: "employee_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_artifact_defect_details_revision_fkey";
            columns: ["revision_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "work_artifact_revisions";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      work_artifact_measurement_lines: {
        Row: {
          description: string;
          id: string;
          line_number: number;
          location: string | null;
          note: string | null;
          organization_id: string;
          quantity: number;
          revision_id: string;
          unit: Database["public"]["Enums"]["work_artifact_measurement_unit"];
        };
        Insert: {
          description: string;
          id: string;
          line_number: number;
          location?: string | null;
          note?: string | null;
          organization_id: string;
          quantity: number;
          revision_id: string;
          unit: Database["public"]["Enums"]["work_artifact_measurement_unit"];
        };
        Update: {
          description?: string;
          id?: string;
          line_number?: number;
          location?: string | null;
          note?: string | null;
          organization_id?: string;
          quantity?: number;
          revision_id?: string;
          unit?: Database["public"]["Enums"]["work_artifact_measurement_unit"];
        };
        Relationships: [
          {
            foreignKeyName: "work_artifact_measurement_lines_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_artifact_measurement_lines_revision_fkey";
            columns: ["revision_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "work_artifact_revisions";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      work_artifact_revision_documents: {
        Row: {
          content_hash: string | null;
          created_at: string;
          created_by: string;
          description: string | null;
          document_id: string;
          id: string;
          organization_id: string;
          relation: Database["public"]["Enums"]["work_artifact_document_relation"];
          renderer_version: string | null;
          revision_id: string;
        };
        Insert: {
          content_hash?: string | null;
          created_at?: string;
          created_by: string;
          description?: string | null;
          document_id: string;
          id: string;
          organization_id: string;
          relation: Database["public"]["Enums"]["work_artifact_document_relation"];
          renderer_version?: string | null;
          revision_id: string;
        };
        Update: {
          content_hash?: string | null;
          created_at?: string;
          created_by?: string;
          description?: string | null;
          document_id?: string;
          id?: string;
          organization_id?: string;
          relation?: Database["public"]["Enums"]["work_artifact_document_relation"];
          renderer_version?: string | null;
          revision_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_artifact_revision_documents_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_artifact_revision_documents_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_artifact_revision_documents_revision_fkey";
            columns: ["revision_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "work_artifact_revisions";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      work_artifact_revision_sources: {
        Row: {
          created_at: string;
          created_by: string;
          description: string | null;
          id: string;
          inventory_movement_id: string | null;
          organization_id: string;
          revision_id: string;
          time_entry_id: string | null;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          description?: string | null;
          id: string;
          inventory_movement_id?: string | null;
          organization_id: string;
          revision_id: string;
          time_entry_id?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          description?: string | null;
          id?: string;
          inventory_movement_id?: string | null;
          organization_id?: string;
          revision_id?: string;
          time_entry_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "work_artifact_revision_sources_inventory_movement_id_fkey";
            columns: ["inventory_movement_id"];
            isOneToOne: false;
            referencedRelation: "inventory_movements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_artifact_revision_sources_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_artifact_revision_sources_revision_fkey";
            columns: ["revision_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "work_artifact_revisions";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "work_artifact_revision_sources_time_entry_id_fkey";
            columns: ["time_entry_id"];
            isOneToOne: false;
            referencedRelation: "time_entries";
            referencedColumns: ["id"];
          },
        ];
      };
      work_artifact_revisions: {
        Row: {
          artifact_id: string;
          captured_at: string;
          correction_reason: string | null;
          corrects_revision_id: string | null;
          created_at: string;
          created_by: string;
          customer_statement: string | null;
          decisions: string | null;
          deliveries: string | null;
          id: string;
          impediments: string | null;
          instruction_item_id: string | null;
          kind: Database["public"]["Enums"]["work_artifact_kind"];
          materials_summary: string | null;
          measurement_date: string | null;
          measurement_location: string | null;
          measurement_notes: string | null;
          next_visit_at: string | null;
          notable_events: string | null;
          organization_id: string;
          outstanding_work: string | null;
          people_present: string | null;
          performed_work: string | null;
          progress: string | null;
          requires_customer_response: boolean;
          requires_signature: boolean;
          revision_number: number;
          site_conditions: string | null;
          site_id: string | null;
          summary: string | null;
          title: string;
          visibility: Database["public"]["Enums"]["work_artifact_visibility"];
          visit_ended_at: string | null;
          visit_started_at: string | null;
          weather_conditions: string | null;
          work_date: string | null;
        };
        Insert: {
          artifact_id: string;
          captured_at: string;
          correction_reason?: string | null;
          corrects_revision_id?: string | null;
          created_at?: string;
          created_by: string;
          customer_statement?: string | null;
          decisions?: string | null;
          deliveries?: string | null;
          id: string;
          impediments?: string | null;
          instruction_item_id?: string | null;
          kind: Database["public"]["Enums"]["work_artifact_kind"];
          materials_summary?: string | null;
          measurement_date?: string | null;
          measurement_location?: string | null;
          measurement_notes?: string | null;
          next_visit_at?: string | null;
          notable_events?: string | null;
          organization_id: string;
          outstanding_work?: string | null;
          people_present?: string | null;
          performed_work?: string | null;
          progress?: string | null;
          requires_customer_response?: boolean;
          requires_signature?: boolean;
          revision_number: number;
          site_conditions?: string | null;
          site_id?: string | null;
          summary?: string | null;
          title: string;
          visibility: Database["public"]["Enums"]["work_artifact_visibility"];
          visit_ended_at?: string | null;
          visit_started_at?: string | null;
          weather_conditions?: string | null;
          work_date?: string | null;
        };
        Update: {
          artifact_id?: string;
          captured_at?: string;
          correction_reason?: string | null;
          corrects_revision_id?: string | null;
          created_at?: string;
          created_by?: string;
          customer_statement?: string | null;
          decisions?: string | null;
          deliveries?: string | null;
          id?: string;
          impediments?: string | null;
          instruction_item_id?: string | null;
          kind?: Database["public"]["Enums"]["work_artifact_kind"];
          materials_summary?: string | null;
          measurement_date?: string | null;
          measurement_location?: string | null;
          measurement_notes?: string | null;
          next_visit_at?: string | null;
          notable_events?: string | null;
          organization_id?: string;
          outstanding_work?: string | null;
          people_present?: string | null;
          performed_work?: string | null;
          progress?: string | null;
          requires_customer_response?: boolean;
          requires_signature?: boolean;
          revision_number?: number;
          site_conditions?: string | null;
          site_id?: string | null;
          summary?: string | null;
          title?: string;
          visibility?: Database["public"]["Enums"]["work_artifact_visibility"];
          visit_ended_at?: string | null;
          visit_started_at?: string | null;
          weather_conditions?: string | null;
          work_date?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "work_artifact_revisions_artifact_fkey";
            columns: ["artifact_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "work_artifacts";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "work_artifact_revisions_corrects_fkey";
            columns: ["corrects_revision_id"];
            isOneToOne: false;
            referencedRelation: "work_artifact_revisions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_artifact_revisions_instruction_item_id_fkey";
            columns: ["instruction_item_id"];
            isOneToOne: false;
            referencedRelation: "job_instruction_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_artifact_revisions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_artifact_revisions_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "client_sites";
            referencedColumns: ["id"];
          },
        ];
      };
      work_artifacts: {
        Row: {
          created_at: string;
          created_by: string;
          current_revision_id: string | null;
          id: string;
          job_id: string | null;
          kind: Database["public"]["Enums"]["work_artifact_kind"];
          organization_id: string;
          project_id: string | null;
          status: Database["public"]["Enums"]["work_artifact_status"];
          updated_at: string;
          version: number;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          current_revision_id?: string | null;
          id: string;
          job_id?: string | null;
          kind: Database["public"]["Enums"]["work_artifact_kind"];
          organization_id: string;
          project_id?: string | null;
          status?: Database["public"]["Enums"]["work_artifact_status"];
          updated_at?: string;
          version?: number;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          current_revision_id?: string | null;
          id?: string;
          job_id?: string | null;
          kind?: Database["public"]["Enums"]["work_artifact_kind"];
          organization_id?: string;
          project_id?: string | null;
          status?: Database["public"]["Enums"]["work_artifact_status"];
          updated_at?: string;
          version?: number;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "work_artifacts_current_revision_fkey";
            columns: ["current_revision_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "work_artifact_revisions";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "work_artifacts_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_artifacts_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_artifacts_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      work_blocker_events: {
        Row: {
          after_state: Json | null;
          before_state: Json | null;
          blocker_id: string;
          created_at: string;
          created_by: string | null;
          event_type: string;
          id: string;
          organization_id: string;
        };
        Insert: {
          after_state?: Json | null;
          before_state?: Json | null;
          blocker_id: string;
          created_at?: string;
          created_by?: string | null;
          event_type: string;
          id?: string;
          organization_id: string;
        };
        Update: {
          after_state?: Json | null;
          before_state?: Json | null;
          blocker_id?: string;
          created_at?: string;
          created_by?: string | null;
          event_type?: string;
          id?: string;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_blocker_events_blocker_id_fkey";
            columns: ["blocker_id"];
            isOneToOne: false;
            referencedRelation: "work_blockers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_blocker_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      work_blockers: {
        Row: {
          created_at: string;
          created_by: string | null;
          details: string | null;
          id: string;
          instruction_item_id: string | null;
          is_legacy: boolean;
          job_id: string | null;
          kind: Database["public"]["Enums"]["work_blocker_kind"];
          legacy_source: string | null;
          next_review_date: string | null;
          organization_id: string;
          parent_project_parking_blocker_id: string | null;
          project_id: string | null;
          reason: Database["public"]["Enums"]["work_blocker_reason"] | null;
          resolution_note: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          responsible_employee_record_id: string | null;
          state: Database["public"]["Enums"]["work_blocker_state"];
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          details?: string | null;
          id?: string;
          instruction_item_id?: string | null;
          is_legacy?: boolean;
          job_id?: string | null;
          kind?: Database["public"]["Enums"]["work_blocker_kind"];
          legacy_source?: string | null;
          next_review_date?: string | null;
          organization_id: string;
          parent_project_parking_blocker_id?: string | null;
          project_id?: string | null;
          reason?: Database["public"]["Enums"]["work_blocker_reason"] | null;
          resolution_note?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          responsible_employee_record_id?: string | null;
          state?: Database["public"]["Enums"]["work_blocker_state"];
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          details?: string | null;
          id?: string;
          instruction_item_id?: string | null;
          is_legacy?: boolean;
          job_id?: string | null;
          kind?: Database["public"]["Enums"]["work_blocker_kind"];
          legacy_source?: string | null;
          next_review_date?: string | null;
          organization_id?: string;
          parent_project_parking_blocker_id?: string | null;
          project_id?: string | null;
          reason?: Database["public"]["Enums"]["work_blocker_reason"] | null;
          resolution_note?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          responsible_employee_record_id?: string | null;
          state?: Database["public"]["Enums"]["work_blocker_state"];
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "work_blockers_instruction_item_id_fkey";
            columns: ["instruction_item_id"];
            isOneToOne: false;
            referencedRelation: "job_instruction_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_blockers_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_blockers_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_blockers_parent_project_parking_blocker_id_fkey";
            columns: ["parent_project_parking_blocker_id"];
            isOneToOne: false;
            referencedRelation: "work_blockers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_blockers_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_blockers_responsible_employee_record_id_fkey";
            columns: ["responsible_employee_record_id"];
            isOneToOne: false;
            referencedRelation: "employee_records";
            referencedColumns: ["id"];
          },
        ];
      };
      work_dependencies: {
        Row: {
          artifact_approval_action_id: string | null;
          created_at: string;
          created_by: string | null;
          declared_kind:
            | Database["public"]["Enums"]["work_declared_dependency_kind"]
            | null;
          dependent_job_id: string | null;
          dependent_project_id: string | null;
          description: string | null;
          effect: Database["public"]["Enums"]["work_dependency_effect"];
          id: string;
          manual_state:
            | Database["public"]["Enums"]["work_dependency_manual_state"]
            | null;
          organization_id: string;
          predecessor_instruction_item_id: string | null;
          predecessor_job_id: string | null;
          predecessor_project_id: string | null;
          removed_at: string | null;
          removed_by: string | null;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          artifact_approval_action_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          declared_kind?:
            | Database["public"]["Enums"]["work_declared_dependency_kind"]
            | null;
          dependent_job_id?: string | null;
          dependent_project_id?: string | null;
          description?: string | null;
          effect: Database["public"]["Enums"]["work_dependency_effect"];
          id?: string;
          manual_state?:
            | Database["public"]["Enums"]["work_dependency_manual_state"]
            | null;
          organization_id: string;
          predecessor_instruction_item_id?: string | null;
          predecessor_job_id?: string | null;
          predecessor_project_id?: string | null;
          removed_at?: string | null;
          removed_by?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          artifact_approval_action_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          declared_kind?:
            | Database["public"]["Enums"]["work_declared_dependency_kind"]
            | null;
          dependent_job_id?: string | null;
          dependent_project_id?: string | null;
          description?: string | null;
          effect?: Database["public"]["Enums"]["work_dependency_effect"];
          id?: string;
          manual_state?:
            | Database["public"]["Enums"]["work_dependency_manual_state"]
            | null;
          organization_id?: string;
          predecessor_instruction_item_id?: string | null;
          predecessor_job_id?: string | null;
          predecessor_project_id?: string | null;
          removed_at?: string | null;
          removed_by?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "work_dependencies_artifact_approval_action_id_fkey";
            columns: ["artifact_approval_action_id"];
            isOneToOne: false;
            referencedRelation: "work_artifact_actions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_dependencies_dependent_job_id_fkey";
            columns: ["dependent_job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_dependencies_dependent_project_id_fkey";
            columns: ["dependent_project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_dependencies_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_dependencies_predecessor_instruction_item_id_fkey";
            columns: ["predecessor_instruction_item_id"];
            isOneToOne: false;
            referencedRelation: "job_instruction_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_dependencies_predecessor_job_id_fkey";
            columns: ["predecessor_job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_dependencies_predecessor_project_id_fkey";
            columns: ["predecessor_project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      work_dependency_events: {
        Row: {
          after_state: Json | null;
          before_state: Json | null;
          created_at: string;
          created_by: string | null;
          dependency_id: string;
          event_type: string;
          id: string;
          organization_id: string;
          reason: string | null;
        };
        Insert: {
          after_state?: Json | null;
          before_state?: Json | null;
          created_at?: string;
          created_by?: string | null;
          dependency_id: string;
          event_type: string;
          id?: string;
          organization_id: string;
          reason?: string | null;
        };
        Update: {
          after_state?: Json | null;
          before_state?: Json | null;
          created_at?: string;
          created_by?: string | null;
          dependency_id?: string;
          event_type?: string;
          id?: string;
          organization_id?: string;
          reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "work_dependency_events_dependency_id_fkey";
            columns: ["dependency_id"];
            isOneToOne: false;
            referencedRelation: "work_dependencies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_dependency_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      work_execution_events: {
        Row: {
          created_at: string;
          created_by: string | null;
          event_payload: Json;
          event_type: string;
          from_state:
            | Database["public"]["Enums"]["work_execution_state"]
            | null;
          gate_fingerprint: string;
          gate_snapshot: Json;
          id: string;
          job_id: string | null;
          organization_id: string;
          previous_version: number;
          project_id: string | null;
          reason: string | null;
          resulting_version: number;
          to_state: Database["public"]["Enums"]["work_execution_state"] | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          event_payload?: Json;
          event_type: string;
          from_state?:
            | Database["public"]["Enums"]["work_execution_state"]
            | null;
          gate_fingerprint: string;
          gate_snapshot?: Json;
          id?: string;
          job_id?: string | null;
          organization_id: string;
          previous_version: number;
          project_id?: string | null;
          reason?: string | null;
          resulting_version: number;
          to_state?: Database["public"]["Enums"]["work_execution_state"] | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          event_payload?: Json;
          event_type?: string;
          from_state?:
            | Database["public"]["Enums"]["work_execution_state"]
            | null;
          gate_fingerprint?: string;
          gate_snapshot?: Json;
          id?: string;
          job_id?: string | null;
          organization_id?: string;
          previous_version?: number;
          project_id?: string | null;
          reason?: string | null;
          resulting_version?: number;
          to_state?: Database["public"]["Enums"]["work_execution_state"] | null;
        };
        Relationships: [
          {
            foreignKeyName: "work_execution_events_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_execution_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_execution_events_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      work_handover_draft_items: {
        Row: {
          child_handover_release_id: string | null;
          created_at: string;
          created_by: string;
          customer_label: string;
          document_id: string | null;
          document_storage_path: string | null;
          document_version_number: number | null;
          id: string;
          organization_id: string;
          package_id: string;
          sort_order: number;
          source_kind: Database["public"]["Enums"]["work_handover_source_kind"];
          work_artifact_revision_id: string | null;
        };
        Insert: {
          child_handover_release_id?: string | null;
          created_at?: string;
          created_by: string;
          customer_label: string;
          document_id?: string | null;
          document_storage_path?: string | null;
          document_version_number?: number | null;
          id: string;
          organization_id: string;
          package_id: string;
          sort_order: number;
          source_kind: Database["public"]["Enums"]["work_handover_source_kind"];
          work_artifact_revision_id?: string | null;
        };
        Update: {
          child_handover_release_id?: string | null;
          created_at?: string;
          created_by?: string;
          customer_label?: string;
          document_id?: string | null;
          document_storage_path?: string | null;
          document_version_number?: number | null;
          id?: string;
          organization_id?: string;
          package_id?: string;
          sort_order?: number;
          source_kind?: Database["public"]["Enums"]["work_handover_source_kind"];
          work_artifact_revision_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "work_handover_draft_items_child_handover_release_fkey";
            columns: ["child_handover_release_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "work_handover_releases";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "work_handover_draft_items_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_handover_draft_items_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_handover_draft_items_package_fkey";
            columns: ["package_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "work_handover_packages";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "work_handover_draft_items_work_artifact_revision_id_fkey";
            columns: ["work_artifact_revision_id"];
            isOneToOne: false;
            referencedRelation: "work_artifact_revisions";
            referencedColumns: ["id"];
          },
        ];
      };
      work_handover_events: {
        Row: {
          created_at: string;
          created_by: string;
          event_payload: Json;
          event_type: Database["public"]["Enums"]["work_handover_event_type"];
          from_state:
            | Database["public"]["Enums"]["work_handover_package_state"]
            | null;
          id: string;
          organization_id: string;
          package_id: string;
          previous_release_id: string | null;
          reason: string | null;
          release_id: string | null;
          request_fingerprint: string | null;
          request_id: string | null;
          to_state:
            | Database["public"]["Enums"]["work_handover_package_state"]
            | null;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          event_payload?: Json;
          event_type: Database["public"]["Enums"]["work_handover_event_type"];
          from_state?:
            | Database["public"]["Enums"]["work_handover_package_state"]
            | null;
          id: string;
          organization_id: string;
          package_id: string;
          previous_release_id?: string | null;
          reason?: string | null;
          release_id?: string | null;
          request_fingerprint?: string | null;
          request_id?: string | null;
          to_state?:
            | Database["public"]["Enums"]["work_handover_package_state"]
            | null;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          event_payload?: Json;
          event_type?: Database["public"]["Enums"]["work_handover_event_type"];
          from_state?:
            | Database["public"]["Enums"]["work_handover_package_state"]
            | null;
          id?: string;
          organization_id?: string;
          package_id?: string;
          previous_release_id?: string | null;
          reason?: string | null;
          release_id?: string | null;
          request_fingerprint?: string | null;
          request_id?: string | null;
          to_state?:
            | Database["public"]["Enums"]["work_handover_package_state"]
            | null;
        };
        Relationships: [
          {
            foreignKeyName: "work_handover_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_handover_events_package_fkey";
            columns: ["package_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "work_handover_packages";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "work_handover_events_previous_release_fkey";
            columns: ["previous_release_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "work_handover_releases";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "work_handover_events_release_fkey";
            columns: ["release_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "work_handover_releases";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      work_handover_packages: {
        Row: {
          created_at: string;
          created_by: string;
          current_release_id: string | null;
          id: string;
          job_id: string | null;
          organization_id: string;
          project_id: string | null;
          state: Database["public"]["Enums"]["work_handover_package_state"];
          updated_at: string;
          updated_by: string;
          version: number;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          current_release_id?: string | null;
          id: string;
          job_id?: string | null;
          organization_id: string;
          project_id?: string | null;
          state?: Database["public"]["Enums"]["work_handover_package_state"];
          updated_at?: string;
          updated_by: string;
          version?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          current_release_id?: string | null;
          id?: string;
          job_id?: string | null;
          organization_id?: string;
          project_id?: string | null;
          state?: Database["public"]["Enums"]["work_handover_package_state"];
          updated_at?: string;
          updated_by?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "work_handover_packages_current_release_fkey";
            columns: ["current_release_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "work_handover_releases";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "work_handover_packages_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_handover_packages_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_handover_packages_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      work_handover_release_items: {
        Row: {
          child_handover_release_id: string | null;
          customer_label: string;
          customer_payload: Json;
          document_id: string | null;
          document_storage_path: string | null;
          document_version_number: number | null;
          id: string;
          organization_id: string;
          release_id: string;
          sort_order: number;
          source_kind: Database["public"]["Enums"]["work_handover_source_kind"];
          work_artifact_revision_id: string | null;
        };
        Insert: {
          child_handover_release_id?: string | null;
          customer_label: string;
          customer_payload: Json;
          document_id?: string | null;
          document_storage_path?: string | null;
          document_version_number?: number | null;
          id: string;
          organization_id: string;
          release_id: string;
          sort_order: number;
          source_kind: Database["public"]["Enums"]["work_handover_source_kind"];
          work_artifact_revision_id?: string | null;
        };
        Update: {
          child_handover_release_id?: string | null;
          customer_label?: string;
          customer_payload?: Json;
          document_id?: string | null;
          document_storage_path?: string | null;
          document_version_number?: number | null;
          id?: string;
          organization_id?: string;
          release_id?: string;
          sort_order?: number;
          source_kind?: Database["public"]["Enums"]["work_handover_source_kind"];
          work_artifact_revision_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "work_handover_release_items_child_handover_release_fkey";
            columns: ["child_handover_release_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "work_handover_releases";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "work_handover_release_items_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_handover_release_items_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_handover_release_items_release_fkey";
            columns: ["release_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "work_handover_releases";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "work_handover_release_items_work_artifact_revision_id_fkey";
            columns: ["work_artifact_revision_id"];
            isOneToOne: false;
            referencedRelation: "work_artifact_revisions";
            referencedColumns: ["id"];
          },
        ];
      };
      work_handover_releases: {
        Row: {
          commercial_readiness: Database["public"]["Enums"]["work_handover_commercial_readiness_state"];
          content_hash: string;
          created_at: string;
          gate_fingerprint: string;
          gate_snapshot: Json;
          id: string;
          material_summary: Json;
          organization_id: string;
          overridden_gates: Json;
          override_reason: string | null;
          package_document_id: string;
          package_id: string;
          previous_release_id: string | null;
          release_number: number;
          renderer_version: string;
          request_id: string;
          responsibility_snapshot: Json;
          reviewed_at: string;
          reviewed_by: string;
          target_snapshot: Json;
          time_summary: Json;
          unassessed_facts: Json;
        };
        Insert: {
          commercial_readiness: Database["public"]["Enums"]["work_handover_commercial_readiness_state"];
          content_hash: string;
          created_at?: string;
          gate_fingerprint: string;
          gate_snapshot: Json;
          id: string;
          material_summary?: Json;
          organization_id: string;
          overridden_gates?: Json;
          override_reason?: string | null;
          package_document_id: string;
          package_id: string;
          previous_release_id?: string | null;
          release_number: number;
          renderer_version: string;
          request_id: string;
          responsibility_snapshot: Json;
          reviewed_at?: string;
          reviewed_by: string;
          target_snapshot: Json;
          time_summary?: Json;
          unassessed_facts?: Json;
        };
        Update: {
          commercial_readiness?: Database["public"]["Enums"]["work_handover_commercial_readiness_state"];
          content_hash?: string;
          created_at?: string;
          gate_fingerprint?: string;
          gate_snapshot?: Json;
          id?: string;
          material_summary?: Json;
          organization_id?: string;
          overridden_gates?: Json;
          override_reason?: string | null;
          package_document_id?: string;
          package_id?: string;
          previous_release_id?: string | null;
          release_number?: number;
          renderer_version?: string;
          request_id?: string;
          responsibility_snapshot?: Json;
          reviewed_at?: string;
          reviewed_by?: string;
          target_snapshot?: Json;
          time_summary?: Json;
          unassessed_facts?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "work_handover_releases_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_handover_releases_package_document_id_fkey";
            columns: ["package_document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_handover_releases_package_fkey";
            columns: ["package_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "work_handover_packages";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "work_handover_releases_previous_fkey";
            columns: ["previous_release_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "work_handover_releases";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      work_schedules: {
        Row: {
          created_at: string;
          created_by: string | null;
          employee_record_id: string;
          friday_minutes: number;
          id: string;
          monday_minutes: number;
          note: string | null;
          organization_id: string;
          saturday_minutes: number;
          sunday_minutes: number;
          thursday_minutes: number;
          tuesday_minutes: number;
          updated_at: string;
          valid_from: string;
          wednesday_minutes: number;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          employee_record_id: string;
          friday_minutes?: number;
          id?: string;
          monday_minutes?: number;
          note?: string | null;
          organization_id: string;
          saturday_minutes?: number;
          sunday_minutes?: number;
          thursday_minutes?: number;
          tuesday_minutes?: number;
          updated_at?: string;
          valid_from: string;
          wednesday_minutes?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          employee_record_id?: string;
          friday_minutes?: number;
          id?: string;
          monday_minutes?: number;
          note?: string | null;
          organization_id?: string;
          saturday_minutes?: number;
          sunday_minutes?: number;
          thursday_minutes?: number;
          tuesday_minutes?: number;
          updated_at?: string;
          valid_from?: string;
          wednesday_minutes?: number;
        };
        Relationships: [
          {
            foreignKeyName: "work_schedules_employee_record_id_fkey";
            columns: ["employee_record_id"];
            isOneToOne: false;
            referencedRelation: "employee_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_schedules_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      work_template_applications: {
        Row: {
          applied_at: string;
          applied_by: string | null;
          id: string;
          idempotency_key: string;
          job_id: string | null;
          organization_id: string;
          project_id: string | null;
          template_id: string;
          template_version_id: string;
        };
        Insert: {
          applied_at?: string;
          applied_by?: string | null;
          id?: string;
          idempotency_key: string;
          job_id?: string | null;
          organization_id: string;
          project_id?: string | null;
          template_id: string;
          template_version_id: string;
        };
        Update: {
          applied_at?: string;
          applied_by?: string | null;
          id?: string;
          idempotency_key?: string;
          job_id?: string | null;
          organization_id?: string;
          project_id?: string | null;
          template_id?: string;
          template_version_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_template_applications_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_template_applications_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_template_applications_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_template_applications_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "work_templates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_template_applications_template_version_id_fkey";
            columns: ["template_version_id"];
            isOneToOne: false;
            referencedRelation: "work_template_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      work_template_capability_requirements: {
        Row: {
          capability_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          organization_id: string;
          require_confirmation: boolean;
          sort_order: number;
          updated_at: string;
          version_id: string;
        };
        Insert: {
          capability_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          organization_id: string;
          require_confirmation?: boolean;
          sort_order: number;
          updated_at?: string;
          version_id: string;
        };
        Update: {
          capability_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          organization_id?: string;
          require_confirmation?: boolean;
          sort_order?: number;
          updated_at?: string;
          version_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_template_capability_requirements_capability_id_fkey";
            columns: ["capability_id"];
            isOneToOne: false;
            referencedRelation: "organization_capabilities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_template_capability_requirements_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_template_capability_requirements_version_id_fkey";
            columns: ["version_id"];
            isOneToOne: false;
            referencedRelation: "work_template_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      work_template_events: {
        Row: {
          actor_id: string | null;
          application_id: string | null;
          created_at: string;
          event_payload: Json;
          event_type: string;
          id: string;
          organization_id: string;
          template_id: string;
          template_version_id: string | null;
        };
        Insert: {
          actor_id?: string | null;
          application_id?: string | null;
          created_at?: string;
          event_payload?: Json;
          event_type: string;
          id?: string;
          organization_id: string;
          template_id: string;
          template_version_id?: string | null;
        };
        Update: {
          actor_id?: string | null;
          application_id?: string | null;
          created_at?: string;
          event_payload?: Json;
          event_type?: string;
          id?: string;
          organization_id?: string;
          template_id?: string;
          template_version_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "work_template_events_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "work_template_applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_template_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_template_events_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "work_templates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_template_events_template_version_id_fkey";
            columns: ["template_version_id"];
            isOneToOne: false;
            referencedRelation: "work_template_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      work_template_item_dependencies: {
        Row: {
          created_at: string;
          created_by: string | null;
          dependent_item_id: string;
          id: string;
          organization_id: string;
          predecessor_item_id: string;
          version_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          dependent_item_id: string;
          id?: string;
          organization_id: string;
          predecessor_item_id: string;
          version_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          dependent_item_id?: string;
          id?: string;
          organization_id?: string;
          predecessor_item_id?: string;
          version_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_template_item_dependencies_dependent_item_id_fkey";
            columns: ["dependent_item_id"];
            isOneToOne: false;
            referencedRelation: "work_template_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_template_item_dependencies_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_template_item_dependencies_predecessor_item_id_fkey";
            columns: ["predecessor_item_id"];
            isOneToOne: false;
            referencedRelation: "work_template_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_template_item_dependencies_version_id_fkey";
            columns: ["version_id"];
            isOneToOne: false;
            referencedRelation: "work_template_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      work_template_item_evidence_requirements: {
        Row: {
          created_at: string;
          created_by: string | null;
          description: string;
          document_category: string;
          id: string;
          organization_id: string;
          sort_order: number;
          template_item_id: string;
          updated_at: string;
          version_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          description: string;
          document_category: string;
          id?: string;
          organization_id: string;
          sort_order: number;
          template_item_id: string;
          updated_at?: string;
          version_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          description?: string;
          document_category?: string;
          id?: string;
          organization_id?: string;
          sort_order?: number;
          template_item_id?: string;
          updated_at?: string;
          version_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_template_item_evidence_requirements_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_template_item_evidence_requirements_template_item_id_fkey";
            columns: ["template_item_id"];
            isOneToOne: false;
            referencedRelation: "work_template_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_template_item_evidence_requirements_version_id_fkey";
            columns: ["version_id"];
            isOneToOne: false;
            referencedRelation: "work_template_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      work_template_items: {
        Row: {
          content: string;
          copied_from_item_id: string | null;
          created_at: string;
          created_by: string | null;
          group_label: string | null;
          id: string;
          item_kind: string;
          notes: string | null;
          organization_id: string;
          requirement_state: string;
          sort_order: number;
          updated_at: string;
          version_id: string;
        };
        Insert: {
          content: string;
          copied_from_item_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          group_label?: string | null;
          id?: string;
          item_kind: string;
          notes?: string | null;
          organization_id: string;
          requirement_state: string;
          sort_order: number;
          updated_at?: string;
          version_id: string;
        };
        Update: {
          content?: string;
          copied_from_item_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          group_label?: string | null;
          id?: string;
          item_kind?: string;
          notes?: string | null;
          organization_id?: string;
          requirement_state?: string;
          sort_order?: number;
          updated_at?: string;
          version_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_template_items_copied_from_item_id_fkey";
            columns: ["copied_from_item_id"];
            isOneToOne: false;
            referencedRelation: "work_template_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_template_items_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_template_items_version_id_fkey";
            columns: ["version_id"];
            isOneToOne: false;
            referencedRelation: "work_template_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      work_template_material_lines: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          is_billable: boolean;
          item_id: string;
          notes: string | null;
          organization_id: string;
          planned_quantity: number;
          preferred_location_id: string | null;
          sort_order: number;
          updated_at: string;
          version_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_billable?: boolean;
          item_id: string;
          notes?: string | null;
          organization_id: string;
          planned_quantity: number;
          preferred_location_id?: string | null;
          sort_order: number;
          updated_at?: string;
          version_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_billable?: boolean;
          item_id?: string;
          notes?: string | null;
          organization_id?: string;
          planned_quantity?: number;
          preferred_location_id?: string | null;
          sort_order?: number;
          updated_at?: string;
          version_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_template_material_lines_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "inventory_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_template_material_lines_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_template_material_lines_preferred_location_id_fkey";
            columns: ["preferred_location_id"];
            isOneToOne: false;
            referencedRelation: "inventory_locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_template_material_lines_version_id_fkey";
            columns: ["version_id"];
            isOneToOne: false;
            referencedRelation: "work_template_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      work_template_versions: {
        Row: {
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: string;
          name: string;
          organization_id: string;
          published_at: string | null;
          published_by: string | null;
          status: string;
          template_id: string;
          updated_at: string;
          version_number: number;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          name: string;
          organization_id: string;
          published_at?: string | null;
          published_by?: string | null;
          status?: string;
          template_id: string;
          updated_at?: string;
          version_number: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          name?: string;
          organization_id?: string;
          published_at?: string | null;
          published_by?: string | null;
          status?: string;
          template_id?: string;
          updated_at?: string;
          version_number?: number;
        };
        Relationships: [
          {
            foreignKeyName: "work_template_versions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_template_versions_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "work_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      work_templates: {
        Row: {
          archived_at: string | null;
          archived_by: string | null;
          created_at: string;
          created_by: string | null;
          current_published_version_id: string | null;
          draft_version_id: string | null;
          id: string;
          organization_id: string;
          target_type: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          archived_at?: string | null;
          archived_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          current_published_version_id?: string | null;
          draft_version_id?: string | null;
          id?: string;
          organization_id: string;
          target_type: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          archived_at?: string | null;
          archived_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          current_published_version_id?: string | null;
          draft_version_id?: string | null;
          id?: string;
          organization_id?: string;
          target_type?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "work_templates_current_published_version_id_fkey";
            columns: ["current_published_version_id"];
            isOneToOne: false;
            referencedRelation: "work_template_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_templates_draft_version_id_fkey";
            columns: ["draft_version_id"];
            isOneToOne: false;
            referencedRelation: "work_template_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_templates_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      acknowledge_planning_dispatch: {
        Args: {
          p_actor_id: string;
          p_dispatch_id: string;
          p_expected_revision_number: number;
          p_organization_id: string;
        };
        Returns: string;
      };
      apply_responsibility_configuration: {
        Args: {
          p_actor_id: string;
          p_employee_record_ids: string[];
          p_expected_configuration_id: string;
          p_mode: Database["public"]["Enums"]["responsibility_configuration_mode"];
          p_organization_id: string;
          p_responsibility: Database["public"]["Enums"]["organization_responsibility"];
        };
        Returns: string;
      };
      apply_work_template: {
        Args: {
          p_actor_id: string;
          p_allow_additional?: boolean;
          p_assessed_for_date?: string;
          p_coverage_fingerprint?: string;
          p_coverage_snapshot?: Json;
          p_idempotency_key: string;
          p_job_id?: string;
          p_organization_id: string;
          p_override_reason?: string;
          p_project_id?: string;
          p_requirements_snapshot?: Json;
          p_selected_employee_record_ids?: string[];
          p_selected_user_ids?: string[];
          p_team_source_id?: string;
          p_template_version_id: string;
        };
        Returns: Json;
      };
      apply_work_template_unserialized: {
        Args: {
          p_actor_id: string;
          p_allow_additional?: boolean;
          p_assessed_for_date?: string;
          p_coverage_fingerprint?: string;
          p_coverage_snapshot?: Json;
          p_idempotency_key: string;
          p_job_id?: string;
          p_organization_id: string;
          p_override_reason?: string;
          p_project_id?: string;
          p_requirements_snapshot?: Json;
          p_selected_employee_record_ids?: string[];
          p_selected_user_ids?: string[];
          p_team_source_id?: string;
          p_template_version_id: string;
        };
        Returns: Json;
      };
      batch_reschedule_planning_occurrences: {
        Args: {
          p_actor_id: string;
          p_capacity_fingerprint: string;
          p_capacity_snapshot: Json;
          p_items: Json;
          p_organization_id: string;
          p_override_reason?: string;
          p_qualification_fingerprint: string;
          p_qualification_snapshot: Json;
          p_reason: string;
          p_request_id: string;
        };
        Returns: string[];
      };
      cancel_planning_dispatch: {
        Args: {
          p_actor_id: string;
          p_dispatch_id: string;
          p_organization_id: string;
          p_reason: string;
        };
        Returns: undefined;
      };
      challenge_planning_dispatch: {
        Args: {
          p_actor_id: string;
          p_dispatch_id: string;
          p_expected_revision_number: number;
          p_organization_id: string;
          p_reason: string;
        };
        Returns: string;
      };
      check_user_exists_by_email: {
        Args: { p_email: string };
        Returns: {
          user_exists: boolean;
          user_id: string;
        }[];
      };
      clear_project_execution_override: {
        Args: {
          p_actor_id: string;
          p_expected_version: number;
          p_organization_id: string;
          p_project_id: string;
          p_reason: string;
        };
        Returns: number;
      };
      correct_installed_equipment_terminal_action: {
        Args: {
          p_actor_id: string;
          p_corrects_event_id: string;
          p_effective_at: string;
          p_equipment_id: string;
          p_expected_version: number;
          p_idempotency_key: string;
          p_organization_id: string;
          p_reason: string;
        };
        Returns: {
          archive_reason: string | null;
          archived_at: string | null;
          archived_by: string | null;
          category: Database["public"]["Enums"]["installed_equipment_category"];
          client_id: string;
          commissioning_date: string | null;
          created_at: string;
          created_by: string;
          equipment_number: string;
          id: string;
          installation_date: string | null;
          location_detail: string | null;
          manufacturer: string | null;
          model: string | null;
          name: string;
          organization_id: string;
          parent_equipment_id: string | null;
          predecessor_equipment_id: string | null;
          site_id: string;
          state: Database["public"]["Enums"]["installed_equipment_state"];
          subtype:
            | Database["public"]["Enums"]["installed_equipment_subtype"]
            | null;
          technical_notes: string | null;
          updated_at: string;
          updated_by: string;
          version: number;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
          warranty_basis: string | null;
          warranty_end_date: string | null;
          warranty_provider: string | null;
          warranty_start_date: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "installed_equipment";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_client_follow_up: {
        Args: {
          p_actor_id: string;
          p_client_id: string;
          p_due_at: string;
          p_note: string;
          p_organization_id: string;
          p_owner_user_id: string;
          p_source_id: string;
          p_source_type: string;
          p_title: string;
        };
        Returns: {
          cancelled_at: string | null;
          cancelled_by: string | null;
          client_id: string;
          completed_at: string | null;
          completed_by: string | null;
          created_at: string;
          created_by: string;
          due_at: string;
          id: string;
          note: string | null;
          organization_id: string;
          owner_user_id: string;
          resolution_note: string | null;
          source_id: string | null;
          source_type: string | null;
          status: string;
          title: string;
          updated_at: string;
          updated_by: string;
        };
        SetofOptions: {
          from: "*";
          to: "client_follow_ups";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_installed_equipment: {
        Args: {
          p_actor_id: string;
          p_equipment_id: string;
          p_idempotency_key: string;
          p_organization_id: string;
          p_payload: Json;
        };
        Returns: {
          archive_reason: string | null;
          archived_at: string | null;
          archived_by: string | null;
          category: Database["public"]["Enums"]["installed_equipment_category"];
          client_id: string;
          commissioning_date: string | null;
          created_at: string;
          created_by: string;
          equipment_number: string;
          id: string;
          installation_date: string | null;
          location_detail: string | null;
          manufacturer: string | null;
          model: string | null;
          name: string;
          organization_id: string;
          parent_equipment_id: string | null;
          predecessor_equipment_id: string | null;
          site_id: string;
          state: Database["public"]["Enums"]["installed_equipment_state"];
          subtype:
            | Database["public"]["Enums"]["installed_equipment_subtype"]
            | null;
          technical_notes: string | null;
          updated_at: string;
          updated_by: string;
          version: number;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
          warranty_basis: string | null;
          warranty_end_date: string | null;
          warranty_provider: string | null;
          warranty_start_date: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "installed_equipment";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_planning_entry_materialized: {
        Args: {
          p_actor_id: string;
          p_assignments: Json;
          p_capacity_fingerprint?: string;
          p_capacity_snapshot?: Json;
          p_idempotency_key: string;
          p_occurrences: Json;
          p_organization_id: string;
          p_override_reason?: string;
          p_qualification_fingerprint?: string;
          p_qualification_snapshot?: Json;
          p_series: Json;
        };
        Returns: string[];
      };
      create_responsibility_delegation: {
        Args: {
          p_actor_id: string;
          p_delegator_employee_record_id: string;
          p_note: string;
          p_organization_id: string;
          p_responsibility: Database["public"]["Enums"]["organization_responsibility"];
          p_substitute_employee_record_id: string;
          p_valid_from: string;
          p_valid_until: string;
        };
        Returns: string;
      };
      create_service_case: {
        Args: {
          p_actor_id: string;
          p_idempotency_key: string;
          p_organization_id: string;
          p_payload: Json;
          p_service_case_id: string;
        };
        Returns: {
          access_instructions: string | null;
          case_number: string;
          charge_context: Database["public"]["Enums"]["service_case_charge_context"];
          client_id: string;
          contact_id: string | null;
          created_at: string;
          created_by: string;
          id: string;
          intake_type: Database["public"]["Enums"]["service_case_intake_type"];
          job_id: string | null;
          organization_id: string;
          original_details: string | null;
          original_statement: string;
          resolution_note: string | null;
          site_id: string;
          source_request_id: string | null;
          status: Database["public"]["Enums"]["service_case_status"];
          summary: string;
          triage_note: string | null;
          updated_at: string;
          updated_by: string;
          urgency: Database["public"]["Enums"]["request_urgency"];
          version: number;
        };
        SetofOptions: {
          from: "*";
          to: "service_cases";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_work_artifact_revision: {
        Args: {
          p_actor_id: string;
          p_artifact_id: string;
          p_captured_at: string;
          p_content: Json;
          p_correction_reason: string;
          p_corrects_revision_id: string;
          p_expected_version: number;
          p_job_id: string;
          p_kind: Database["public"]["Enums"]["work_artifact_kind"];
          p_organization_id: string;
          p_project_id: string;
          p_revision_id: string;
          p_submit: boolean;
          p_submit_action_id: string;
          p_title: string;
          p_visibility: Database["public"]["Enums"]["work_artifact_visibility"];
        };
        Returns: Json;
      };
      create_work_template: {
        Args: {
          p_actor_id: string;
          p_description?: string;
          p_name: string;
          p_organization_id: string;
          p_target_type: string;
        };
        Returns: string;
      };
      create_work_template_draft: {
        Args: {
          p_actor_id: string;
          p_organization_id: string;
          p_template_id: string;
        };
        Returns: string;
      };
      end_responsibility_delegation: {
        Args: {
          p_actor_id: string;
          p_delegation_id: string;
          p_revoked_from: string;
        };
        Returns: undefined;
      };
      ensure_inventory_defaults: {
        Args: { p_actor_id: string; p_org_id: string };
        Returns: undefined;
      };
      extend_planning_series_materialization: {
        Args: {
          p_actor_id: string;
          p_assignments: Json;
          p_capacity_fingerprint?: string;
          p_capacity_snapshot?: Json;
          p_expected_generated_through_local: string;
          p_occurrences: Json;
          p_organization_id: string;
          p_override_reason?: string;
          p_qualification_fingerprint?: string;
          p_qualification_snapshot?: Json;
          p_series_id: string;
        };
        Returns: string[];
      };
      finalize_work_artifact_export: {
        Args: {
          p_action_id: string;
          p_actor_id: string;
          p_artifact_id: string;
          p_content_hash: string;
          p_document_id: string;
          p_expected_version: number;
          p_link_id: string;
          p_organization_id: string;
          p_renderer_version: string;
          p_revision_id: string;
        };
        Returns: Json;
      };
      fulfill_instruction_evidence: {
        Args: {
          p_actor_id: string;
          p_artifact_revision_id: string;
          p_document_id: string;
          p_evidence_requirement_id: string;
          p_fulfillment_id: string;
          p_note: string;
          p_organization_id: string;
        };
        Returns: {
          artifact_revision_id: string | null;
          created_at: string;
          created_by: string;
          document_id: string | null;
          evidence_requirement_id: string;
          id: string;
          note: string | null;
          organization_id: string;
          removal_reason: string | null;
          removed_at: string | null;
          removed_by: string | null;
          version: number;
        };
        SetofOptions: {
          from: "*";
          to: "job_instruction_item_evidence_fulfillments";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      generate_job_number: { Args: { p_org_id: string }; Returns: string };
      generate_personnel_number: {
        Args: { p_org_id: string };
        Returns: string;
      };
      generate_project_number: { Args: { p_org_id: string }; Returns: string };
      generate_request_number: { Args: { p_org_id: string }; Returns: string };
      get_invite_by_code: {
        Args: { p_invite_code: string };
        Returns: {
          email: string;
          expires_at: string;
          id: string;
          invited_role: Database["public"]["Enums"]["org_role"];
          org_name: string;
          organization_id: string;
          status: Database["public"]["Enums"]["invite_status"];
        }[];
      };
      get_org_clients: {
        Args: { p_org_id: string };
        Returns: {
          address: string | null;
          client_type: Database["public"]["Enums"]["client_type"];
          created_at: string;
          customer_number: string | null;
          email: string | null;
          id: string;
          name: string;
          notes: string | null;
          organization_id: string;
          phone: string | null;
          updated_at: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "clients";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      get_org_members: {
        Args: { p_org_id: string };
        Returns: {
          email: string;
          first_name: string;
          joined_at: string;
          last_name: string;
          role: Database["public"]["Enums"]["org_role"];
          user_id: string;
        }[];
      };
      get_org_members_for_user: {
        Args: { p_org_id: string; p_user_id: string };
        Returns: {
          email: string;
          first_name: string;
          joined_at: string;
          last_name: string;
          role: Database["public"]["Enums"]["org_role"];
          user_id: string;
        }[];
      };
      get_user_admin_or_manager_org_ids: {
        Args: { p_user_id: string };
        Returns: string[];
      };
      get_user_admin_org_ids: {
        Args: { p_user_id: string };
        Returns: string[];
      };
      get_user_org_ids: { Args: { p_user_id: string }; Returns: string[] };
      get_work_handover_gate_snapshot: {
        Args: {
          p_actor_id: string;
          p_organization_id: string;
          p_target_id: string;
          p_target_type: string;
        };
        Returns: Json;
      };
      get_work_lifecycle_snapshot: {
        Args: {
          p_actor_id: string;
          p_organization_id: string;
          p_target_id: string;
          p_target_type: string;
        };
        Returns: Json;
      };
      is_member_of_org: {
        Args: { p_org_id: string; p_user_id: string };
        Returns: boolean;
      };
      issue_planning_dispatch: {
        Args: {
          p_actor_id: string;
          p_job_id?: string;
          p_note?: string;
          p_occurrence_id?: string;
          p_organization_id: string;
          p_readiness_fingerprint?: string;
          p_readiness_snapshot?: Json;
          p_recipient_employee_record_ids?: string[];
          p_request_id?: string;
        };
        Returns: string;
      };
      link_installed_equipment_source: {
        Args: {
          p_actor_id: string;
          p_equipment_id: string;
          p_expected_version: number;
          p_idempotency_key: string;
          p_organization_id: string;
          p_reason: string;
          p_source: Json;
        };
        Returns: {
          archive_reason: string | null;
          archived_at: string | null;
          archived_by: string | null;
          category: Database["public"]["Enums"]["installed_equipment_category"];
          client_id: string;
          commissioning_date: string | null;
          created_at: string;
          created_by: string;
          equipment_number: string;
          id: string;
          installation_date: string | null;
          location_detail: string | null;
          manufacturer: string | null;
          model: string | null;
          name: string;
          organization_id: string;
          parent_equipment_id: string | null;
          predecessor_equipment_id: string | null;
          site_id: string;
          state: Database["public"]["Enums"]["installed_equipment_state"];
          subtype:
            | Database["public"]["Enums"]["installed_equipment_subtype"]
            | null;
          technical_notes: string | null;
          updated_at: string;
          updated_by: string;
          version: number;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
          warranty_basis: string | null;
          warranty_end_date: string | null;
          warranty_provider: string | null;
          warranty_start_date: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "installed_equipment";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      link_service_case_evidence: {
        Args: {
          p_actor_id: string;
          p_expected_version: number;
          p_idempotency_key: string;
          p_organization_id: string;
          p_service_case_id: string;
          p_work_artifact_revision_id: string;
        };
        Returns: {
          created_at: string;
          created_by: string;
          id: string;
          organization_id: string;
          service_case_id: string;
          work_artifact_revision_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "service_case_evidence_links";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      link_service_case_relation: {
        Args: {
          p_actor_id: string;
          p_expected_version: number;
          p_idempotency_key: string;
          p_organization_id: string;
          p_reason: string;
          p_related_service_case_id: string;
          p_relation_type: Database["public"]["Enums"]["service_case_relation_type"];
          p_service_case_id: string;
        };
        Returns: {
          created_at: string;
          created_by: string;
          id: string;
          organization_id: string;
          reason: string;
          related_service_case_id: string;
          relation_type: Database["public"]["Enums"]["service_case_relation_type"];
          service_case_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "service_case_relations";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      link_work_artifact_document: {
        Args: {
          p_actor_id: string;
          p_artifact_id: string;
          p_content_hash: string;
          p_description: string;
          p_document_id: string;
          p_expected_version: number;
          p_link_id: string;
          p_organization_id: string;
          p_relation: Database["public"]["Enums"]["work_artifact_document_relation"];
          p_renderer_version: string;
          p_revision_id: string;
        };
        Returns: Json;
      };
      link_work_artifact_source: {
        Args: {
          p_actor_id: string;
          p_artifact_id: string;
          p_description: string;
          p_expected_version: number;
          p_inventory_movement_id: string;
          p_link_id: string;
          p_organization_id: string;
          p_revision_id: string;
          p_time_entry_id: string;
        };
        Returns: Json;
      };
      link_work_dependency_artifact_approval: {
        Args: {
          p_action_id: string;
          p_actor_id: string;
          p_dependency_id: string;
          p_expected_version: number;
          p_organization_id: string;
          p_reason: string;
        };
        Returns: {
          artifact_approval_action_id: string | null;
          created_at: string;
          created_by: string | null;
          declared_kind:
            | Database["public"]["Enums"]["work_declared_dependency_kind"]
            | null;
          dependent_job_id: string | null;
          dependent_project_id: string | null;
          description: string | null;
          effect: Database["public"]["Enums"]["work_dependency_effect"];
          id: string;
          manual_state:
            | Database["public"]["Enums"]["work_dependency_manual_state"]
            | null;
          organization_id: string;
          predecessor_instruction_item_id: string | null;
          predecessor_job_id: string | null;
          predecessor_project_id: string | null;
          removed_at: string | null;
          removed_by: string | null;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        SetofOptions: {
          from: "*";
          to: "work_dependencies";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      park_work_target: {
        Args: {
          p_actor_id: string;
          p_details: string;
          p_expected_execution_version: number;
          p_next_review_date: string;
          p_organization_id: string;
          p_reason: Database["public"]["Enums"]["work_blocker_reason"];
          p_responsible_employee_record_id: string;
          p_target_id: string;
          p_target_type: string;
        };
        Returns: string;
      };
      publish_work_template: {
        Args: {
          p_actor_id: string;
          p_organization_id: string;
          p_template_id: string;
        };
        Returns: string;
      };
      record_client_communication_exception: {
        Args: {
          p_actor_id: string;
          p_channel: string;
          p_client_id: string;
          p_contact_id: string;
          p_organization_id: string;
          p_purpose: string;
          p_reason: string;
          p_warnings: Json;
        };
        Returns: string;
      };
      record_customer_commitment: {
        Args: {
          p_actor_id: string;
          p_committed_date: string;
          p_contact_id?: string;
          p_occurrence_id: string;
          p_organization_id: string;
          p_source?: Database["public"]["Enums"]["customer_commitment_source"];
          p_window_end_time?: string;
          p_window_start_time?: string;
        };
        Returns: string;
      };
      record_inventory_movement: {
        Args: {
          p_actor_id: string;
          p_import_batch_id?: string;
          p_item_id: string;
          p_job_id?: string;
          p_job_material_line_id?: string;
          p_location_id: string;
          p_movement_type: string;
          p_organization_id: string;
          p_project_id?: string;
          p_quantity_delta: number;
          p_reason?: string;
        };
        Returns: {
          movement_id: string;
          quantity_after: number;
          quantity_before: number;
        }[];
      };
      record_work_artifact_action: {
        Args: {
          p_action_id: string;
          p_action_type: Database["public"]["Enums"]["work_artifact_action_type"];
          p_actor_id: string;
          p_artifact_id: string;
          p_comment: string;
          p_customer_context: Json;
          p_expected_version: number;
          p_organization_id: string;
          p_reason: string;
          p_responsibility_snapshot: Json;
          p_revision_id: string;
          p_signature_document_id: string;
        };
        Returns: Json;
      };
      record_work_artifact_action_p1_17_inner: {
        Args: {
          p_action_id: string;
          p_action_type: Database["public"]["Enums"]["work_artifact_action_type"];
          p_actor_id: string;
          p_artifact_id: string;
          p_comment: string;
          p_customer_context: Json;
          p_expected_version: number;
          p_organization_id: string;
          p_reason: string;
          p_responsibility_snapshot: Json;
          p_revision_id: string;
          p_signature_document_id: string;
        };
        Returns: Json;
      };
      redeem_organization_invite: {
        Args: { p_invite_code: string };
        Returns: {
          already_member: boolean;
          org_id: string;
          org_name: string;
        }[];
      };
      redeem_organization_invite_for_user: {
        Args: { p_invite_code: string; p_user_id: string };
        Returns: {
          already_member: boolean;
          org_id: string;
          org_name: string;
        }[];
      };
      release_work_handover: {
        Args: {
          p_actor_id: string;
          p_content_hash: string;
          p_document_id: string;
          p_document_link_id: string;
          p_expected_execution_version: number;
          p_expected_gate_fingerprint: string;
          p_expected_package_version: number;
          p_file_name: string;
          p_handover_reason: string;
          p_item_payloads: Json;
          p_material_summary: Json;
          p_organization_id: string;
          p_override_gates: boolean;
          p_override_reason: string;
          p_package_id: string;
          p_release_id: string;
          p_renderer_version: string;
          p_request_id: string;
          p_responsibility_snapshot: Json;
          p_size_bytes: number;
          p_storage_path: string;
          p_target_snapshot: Json;
          p_time_summary: Json;
          p_unassessed_facts: Json;
        };
        Returns: Json;
      };
      release_work_handover_p1_17_inner: {
        Args: {
          p_actor_id: string;
          p_content_hash: string;
          p_document_id: string;
          p_document_link_id: string;
          p_expected_execution_version: number;
          p_expected_gate_fingerprint: string;
          p_expected_package_version: number;
          p_file_name: string;
          p_handover_reason: string;
          p_item_payloads: Json;
          p_material_summary: Json;
          p_organization_id: string;
          p_override_gates: boolean;
          p_override_reason: string;
          p_package_id: string;
          p_release_id: string;
          p_renderer_version: string;
          p_request_id: string;
          p_responsibility_snapshot: Json;
          p_size_bytes: number;
          p_storage_path: string;
          p_target_snapshot: Json;
          p_time_summary: Json;
          p_unassessed_facts: Json;
        };
        Returns: Json;
      };
      remove_instruction_evidence_fulfillment: {
        Args: {
          p_actor_id: string;
          p_expected_version: number;
          p_fulfillment_id: string;
          p_organization_id: string;
          p_reason: string;
        };
        Returns: {
          artifact_revision_id: string | null;
          created_at: string;
          created_by: string;
          document_id: string | null;
          evidence_requirement_id: string;
          id: string;
          note: string | null;
          organization_id: string;
          removal_reason: string | null;
          removed_at: string | null;
          removed_by: string | null;
          version: number;
        };
        SetofOptions: {
          from: "*";
          to: "job_instruction_item_evidence_fulfillments";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      remove_work_dependency: {
        Args: {
          p_actor_id: string;
          p_dependency_id: string;
          p_expected_version: number;
          p_organization_id: string;
          p_reason: string;
        };
        Returns: number;
      };
      renew_employee_capability: {
        Args: {
          p_actor_id: string;
          p_capability_id: string;
          p_confirmation_status: string;
          p_employee_record_id: string;
          p_evidence_state: string;
          p_issuer: string;
          p_operational_note: string;
          p_organization_id: string;
          p_renewal_due_date: string;
          p_supersedes_id: string;
          p_valid_from: string;
          p_valid_until: string;
        };
        Returns: string;
      };
      replace_installed_equipment: {
        Args: {
          p_actor_id: string;
          p_effective_at: string;
          p_expected_version: number;
          p_idempotency_key: string;
          p_organization_id: string;
          p_predecessor_id: string;
          p_reason: string;
          p_successor_id: string;
          p_successor_payload: Json;
        };
        Returns: {
          archive_reason: string | null;
          archived_at: string | null;
          archived_by: string | null;
          category: Database["public"]["Enums"]["installed_equipment_category"];
          client_id: string;
          commissioning_date: string | null;
          created_at: string;
          created_by: string;
          equipment_number: string;
          id: string;
          installation_date: string | null;
          location_detail: string | null;
          manufacturer: string | null;
          model: string | null;
          name: string;
          organization_id: string;
          parent_equipment_id: string | null;
          predecessor_equipment_id: string | null;
          site_id: string;
          state: Database["public"]["Enums"]["installed_equipment_state"];
          subtype:
            | Database["public"]["Enums"]["installed_equipment_subtype"]
            | null;
          technical_notes: string | null;
          updated_at: string;
          updated_by: string;
          version: number;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
          warranty_basis: string | null;
          warranty_end_date: string | null;
          warranty_provider: string | null;
          warranty_start_date: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "installed_equipment";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      replace_job_assignments_with_assessment: {
        Args: {
          p_actor_id: string;
          p_assessed_for_date: string;
          p_coverage_fingerprint: string;
          p_coverage_snapshot: Json;
          p_job_id: string;
          p_organization_id: string;
          p_override_reason: string;
          p_record_assessment: boolean;
          p_requirements_snapshot: Json;
          p_selected_employee_record_ids: string[];
          p_selected_user_ids: string[];
          p_team_source_id: string;
        };
        Returns: undefined;
      };
      replace_job_capability_requirements: {
        Args: {
          p_actor_id: string;
          p_capability_ids: string[];
          p_job_id: string;
          p_organization_id: string;
          p_require_confirmations: boolean[];
        };
        Returns: undefined;
      };
      replace_project_capability_requirements: {
        Args: {
          p_actor_id: string;
          p_capability_ids: string[];
          p_organization_id: string;
          p_project_id: string;
          p_require_confirmations: boolean[];
        };
        Returns: undefined;
      };
      replace_project_capability_requirements_checked: {
        Args: {
          p_actor_id: string;
          p_capability_ids: string[];
          p_expected_capability_ids: string[];
          p_expected_require_confirmations: boolean[];
          p_organization_id: string;
          p_project_id: string;
          p_require_confirmations: boolean[];
        };
        Returns: undefined;
      };
      reschedule_planning_series: {
        Args: {
          p_actor_id: string;
          p_assignments: Json;
          p_capacity_fingerprint: string;
          p_capacity_snapshot: Json;
          p_expected_version: number;
          p_occurrence_id: string;
          p_occurrences: Json;
          p_organization_id: string;
          p_override_reason?: string;
          p_qualification_fingerprint: string;
          p_qualification_snapshot: Json;
          p_scope: string;
          p_series: Json;
        };
        Returns: string[];
      };
      resolve_planning_dispatch_challenge: {
        Args: {
          p_acknowledgement_id: string;
          p_actor_id: string;
          p_organization_id: string;
          p_resolution_reason: string;
        };
        Returns: undefined;
      };
      return_work_handover_for_correction: {
        Args: {
          p_actor_id: string;
          p_expected_execution_version: number;
          p_expected_package_version: number;
          p_organization_id: string;
          p_package_id: string;
          p_reason: string;
          p_request_id: string;
        };
        Returns: Json;
      };
      return_work_handover_for_correction_p1_17_inner: {
        Args: {
          p_actor_id: string;
          p_expected_execution_version: number;
          p_expected_package_version: number;
          p_organization_id: string;
          p_package_id: string;
          p_reason: string;
          p_request_id: string;
        };
        Returns: Json;
      };
      save_client_communication_settings: {
        Args: {
          p_accessibility_note: string;
          p_actor_id: string;
          p_client_id: string;
          p_contact_time_note: string;
          p_do_not_contact_instruction: string;
          p_language_note: string;
          p_organization_id: string;
          p_preferred_channel: string;
          p_preferred_contact_id: string;
          p_source_note: string;
        };
        Returns: {
          accessibility_note: string | null;
          client_id: string;
          contact_time_note: string | null;
          created_at: string;
          created_by: string;
          do_not_contact_instruction: string | null;
          id: string;
          language_note: string | null;
          organization_id: string;
          preferred_channel: string | null;
          preferred_contact_id: string | null;
          source_note: string | null;
          updated_at: string;
          updated_by: string;
        };
        SetofOptions: {
          from: "*";
          to: "client_communication_settings";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      save_work_handover_draft: {
        Args: {
          p_actor_id: string;
          p_expected_version: number;
          p_items: Json;
          p_organization_id: string;
          p_package_id: string;
          p_request_id: string;
          p_target_id: string;
          p_target_type: string;
        };
        Returns: Json;
      };
      save_work_handover_draft_p1_17_inner: {
        Args: {
          p_actor_id: string;
          p_expected_version: number;
          p_items: Json;
          p_organization_id: string;
          p_package_id: string;
          p_request_id: string;
          p_target_id: string;
          p_target_type: string;
        };
        Returns: Json;
      };
      save_work_template_draft: {
        Args: {
          p_actor_id: string;
          p_capabilities?: Json;
          p_dependencies?: Json;
          p_description?: string;
          p_evidence?: Json;
          p_items?: Json;
          p_materials?: Json;
          p_name: string;
          p_organization_id: string;
          p_template_id: string;
        };
        Returns: string;
      };
      set_client_communication_preference: {
        Args: {
          p_actor_id: string;
          p_channel: string;
          p_client_id: string;
          p_contact_id: string;
          p_organization_id: string;
          p_purpose: string;
          p_source_note: string;
          p_state: string;
        };
        Returns: {
          channel: string;
          client_id: string;
          contact_id: string | null;
          created_at: string;
          created_by: string;
          id: string;
          organization_id: string;
          purpose: string;
          source_note: string | null;
          state: string;
          updated_at: string;
          updated_by: string;
        };
        SetofOptions: {
          from: "*";
          to: "client_communication_preferences";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      set_declared_work_dependency_state: {
        Args: {
          p_actor_id: string;
          p_dependency_id: string;
          p_expected_version: number;
          p_organization_id: string;
          p_reason: string;
          p_state: Database["public"]["Enums"]["work_dependency_manual_state"];
        };
        Returns: {
          artifact_approval_action_id: string | null;
          created_at: string;
          created_by: string | null;
          declared_kind:
            | Database["public"]["Enums"]["work_declared_dependency_kind"]
            | null;
          dependent_job_id: string | null;
          dependent_project_id: string | null;
          description: string | null;
          effect: Database["public"]["Enums"]["work_dependency_effect"];
          id: string;
          manual_state:
            | Database["public"]["Enums"]["work_dependency_manual_state"]
            | null;
          organization_id: string;
          predecessor_instruction_item_id: string | null;
          predecessor_job_id: string | null;
          predecessor_project_id: string | null;
          removed_at: string | null;
          removed_by: string | null;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        SetofOptions: {
          from: "*";
          to: "work_dependencies";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      set_installed_equipment_archived: {
        Args: {
          p_actor_id: string;
          p_archived: boolean;
          p_equipment_id: string;
          p_expected_version: number;
          p_idempotency_key: string;
          p_organization_id: string;
          p_reason: string;
        };
        Returns: {
          archive_reason: string | null;
          archived_at: string | null;
          archived_by: string | null;
          category: Database["public"]["Enums"]["installed_equipment_category"];
          client_id: string;
          commissioning_date: string | null;
          created_at: string;
          created_by: string;
          equipment_number: string;
          id: string;
          installation_date: string | null;
          location_detail: string | null;
          manufacturer: string | null;
          model: string | null;
          name: string;
          organization_id: string;
          parent_equipment_id: string | null;
          predecessor_equipment_id: string | null;
          site_id: string;
          state: Database["public"]["Enums"]["installed_equipment_state"];
          subtype:
            | Database["public"]["Enums"]["installed_equipment_subtype"]
            | null;
          technical_notes: string | null;
          updated_at: string;
          updated_by: string;
          version: number;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
          warranty_basis: string | null;
          warranty_end_date: string | null;
          warranty_provider: string | null;
          warranty_start_date: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "installed_equipment";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      set_installed_equipment_work_link: {
        Args: {
          p_actor_id: string;
          p_equipment_id: string;
          p_expected_version: number;
          p_idempotency_key: string;
          p_job_id: string;
          p_linked: boolean;
          p_organization_id: string;
          p_project_id: string;
          p_reason: string;
        };
        Returns: {
          archive_reason: string | null;
          archived_at: string | null;
          archived_by: string | null;
          category: Database["public"]["Enums"]["installed_equipment_category"];
          client_id: string;
          commissioning_date: string | null;
          created_at: string;
          created_by: string;
          equipment_number: string;
          id: string;
          installation_date: string | null;
          location_detail: string | null;
          manufacturer: string | null;
          model: string | null;
          name: string;
          organization_id: string;
          parent_equipment_id: string | null;
          predecessor_equipment_id: string | null;
          site_id: string;
          state: Database["public"]["Enums"]["installed_equipment_state"];
          subtype:
            | Database["public"]["Enums"]["installed_equipment_subtype"]
            | null;
          technical_notes: string | null;
          updated_at: string;
          updated_by: string;
          version: number;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
          warranty_basis: string | null;
          warranty_end_date: string | null;
          warranty_provider: string | null;
          warranty_start_date: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "installed_equipment";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      set_instruction_item_completion: {
        Args: {
          p_actor_id: string;
          p_expected_version: number;
          p_instruction_item_id: string;
          p_is_completed: boolean;
          p_organization_id: string;
        };
        Returns: number;
      };
      set_planning_occurrence_status: {
        Args: {
          p_actor_id: string;
          p_expected_version: number;
          p_occurrence_id: string;
          p_organization_id: string;
          p_reason: string;
          p_status: Database["public"]["Enums"]["planning_occurrence_status"];
        };
        Returns: number;
      };
      set_work_blocker_state: {
        Args: {
          p_actor_id: string;
          p_blocker_id: string;
          p_details?: string;
          p_expected_version: number;
          p_next_review_date?: string;
          p_note: string;
          p_organization_id: string;
          p_reason?: Database["public"]["Enums"]["work_blocker_reason"];
          p_responsible_employee_record_id?: string;
          p_state: Database["public"]["Enums"]["work_blocker_state"];
        };
        Returns: number;
      };
      set_work_template_archived: {
        Args: {
          p_actor_id: string;
          p_archived: boolean;
          p_organization_id: string;
          p_template_id: string;
        };
        Returns: undefined;
      };
      transition_client_follow_up: {
        Args: {
          p_actor_id: string;
          p_follow_up_id: string;
          p_organization_id: string;
          p_reason?: string;
          p_resolution_note: string;
          p_target_status: string;
        };
        Returns: {
          cancelled_at: string | null;
          cancelled_by: string | null;
          client_id: string;
          completed_at: string | null;
          completed_by: string | null;
          created_at: string;
          created_by: string;
          due_at: string;
          id: string;
          note: string | null;
          organization_id: string;
          owner_user_id: string;
          resolution_note: string | null;
          source_id: string | null;
          source_type: string | null;
          status: string;
          title: string;
          updated_at: string;
          updated_by: string;
        };
        SetofOptions: {
          from: "*";
          to: "client_follow_ups";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      transition_installed_equipment: {
        Args: {
          p_actor_id: string;
          p_effective_at: string;
          p_equipment_id: string;
          p_expected_version: number;
          p_idempotency_key: string;
          p_organization_id: string;
          p_reason: string;
          p_to_state: Database["public"]["Enums"]["installed_equipment_state"];
        };
        Returns: {
          archive_reason: string | null;
          archived_at: string | null;
          archived_by: string | null;
          category: Database["public"]["Enums"]["installed_equipment_category"];
          client_id: string;
          commissioning_date: string | null;
          created_at: string;
          created_by: string;
          equipment_number: string;
          id: string;
          installation_date: string | null;
          location_detail: string | null;
          manufacturer: string | null;
          model: string | null;
          name: string;
          organization_id: string;
          parent_equipment_id: string | null;
          predecessor_equipment_id: string | null;
          site_id: string;
          state: Database["public"]["Enums"]["installed_equipment_state"];
          subtype:
            | Database["public"]["Enums"]["installed_equipment_subtype"]
            | null;
          technical_notes: string | null;
          updated_at: string;
          updated_by: string;
          version: number;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
          warranty_basis: string | null;
          warranty_end_date: string | null;
          warranty_provider: string | null;
          warranty_start_date: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "installed_equipment";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      transition_work_execution: {
        Args: {
          p_actor_id: string;
          p_expected_version: number;
          p_organization_id: string;
          p_override_gates?: boolean;
          p_reason?: string;
          p_target_id: string;
          p_target_type: string;
          p_to_state: Database["public"]["Enums"]["work_execution_state"];
        };
        Returns: {
          event_id: string;
          execution_state: Database["public"]["Enums"]["work_execution_state"];
          execution_version: number;
          gate_fingerprint: string;
          gate_snapshot: Json;
        }[];
      };
      transition_work_execution_p1_15: {
        Args: {
          p_actor_id: string;
          p_expected_version: number;
          p_organization_id: string;
          p_override_gates?: boolean;
          p_reason?: string;
          p_target_id: string;
          p_target_type: string;
          p_to_state: Database["public"]["Enums"]["work_execution_state"];
        };
        Returns: {
          event_id: string;
          execution_state: Database["public"]["Enums"]["work_execution_state"];
          execution_version: number;
          gate_fingerprint: string;
          gate_snapshot: Json;
        }[];
      };
      unlink_installed_equipment_document: {
        Args: {
          p_actor_id: string;
          p_idempotency_key: string;
          p_link_id: string;
          p_organization_id: string;
        };
        Returns: boolean;
      };
      unlink_service_case_document: {
        Args: {
          p_actor_id: string;
          p_expected_version: number;
          p_idempotency_key: string;
          p_link_id: string;
          p_organization_id: string;
          p_reason: string;
        };
        Returns: boolean;
      };
      unpark_work_target: {
        Args: {
          p_actor_id: string;
          p_expected_blocker_version: number;
          p_organization_id: string;
          p_reason: string;
          p_target_id: string;
          p_target_type: string;
        };
        Returns: number;
      };
      update_client_follow_up: {
        Args: {
          p_actor_id: string;
          p_due_at: string;
          p_follow_up_id: string;
          p_note: string;
          p_organization_id: string;
          p_owner_user_id: string;
          p_reason?: string;
          p_source_id: string;
          p_source_type: string;
          p_title: string;
        };
        Returns: {
          cancelled_at: string | null;
          cancelled_by: string | null;
          client_id: string;
          completed_at: string | null;
          completed_by: string | null;
          created_at: string;
          created_by: string;
          due_at: string;
          id: string;
          note: string | null;
          organization_id: string;
          owner_user_id: string;
          resolution_note: string | null;
          source_id: string | null;
          source_type: string | null;
          status: string;
          title: string;
          updated_at: string;
          updated_by: string;
        };
        SetofOptions: {
          from: "*";
          to: "client_follow_ups";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_installed_equipment_details: {
        Args: {
          p_actor_id: string;
          p_equipment_id: string;
          p_expected_version: number;
          p_idempotency_key: string;
          p_organization_id: string;
          p_payload: Json;
        };
        Returns: {
          archive_reason: string | null;
          archived_at: string | null;
          archived_by: string | null;
          category: Database["public"]["Enums"]["installed_equipment_category"];
          client_id: string;
          commissioning_date: string | null;
          created_at: string;
          created_by: string;
          equipment_number: string;
          id: string;
          installation_date: string | null;
          location_detail: string | null;
          manufacturer: string | null;
          model: string | null;
          name: string;
          organization_id: string;
          parent_equipment_id: string | null;
          predecessor_equipment_id: string | null;
          site_id: string;
          state: Database["public"]["Enums"]["installed_equipment_state"];
          subtype:
            | Database["public"]["Enums"]["installed_equipment_subtype"]
            | null;
          technical_notes: string | null;
          updated_at: string;
          updated_by: string;
          version: number;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
          warranty_basis: string | null;
          warranty_end_date: string | null;
          warranty_provider: string | null;
          warranty_start_date: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "installed_equipment";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_instruction_item_details: {
        Args: {
          p_actor_id: string;
          p_evidence?: Json;
          p_group_label?: string;
          p_instruction_item_id: string;
          p_item_kind: string;
          p_notes?: string;
          p_organization_id: string;
          p_predecessor_item_ids?: string[];
          p_requirement_state: string;
        };
        Returns: undefined;
      };
      update_planning_dispatch_instruction: {
        Args: {
          p_actor_id: string;
          p_dispatch_id: string;
          p_expected_revision_number: number;
          p_note?: string;
          p_organization_id: string;
          p_recipient_employee_record_ids?: string[];
        };
        Returns: number;
      };
      update_planning_occurrence: {
        Args: {
          p_actor_id: string;
          p_assignments: Json;
          p_capacity_fingerprint: string;
          p_capacity_snapshot: Json;
          p_expected_version: number;
          p_occurrence: Json;
          p_occurrence_id: string;
          p_organization_id: string;
          p_override_reason?: string;
          p_qualification_fingerprint: string;
          p_qualification_snapshot: Json;
        };
        Returns: number;
      };
      update_service_case: {
        Args: {
          p_actor_id: string;
          p_expected_version: number;
          p_idempotency_key: string;
          p_organization_id: string;
          p_payload: Json;
          p_reason: string;
          p_service_case_id: string;
        };
        Returns: {
          access_instructions: string | null;
          case_number: string;
          charge_context: Database["public"]["Enums"]["service_case_charge_context"];
          client_id: string;
          contact_id: string | null;
          created_at: string;
          created_by: string;
          id: string;
          intake_type: Database["public"]["Enums"]["service_case_intake_type"];
          job_id: string | null;
          organization_id: string;
          original_details: string | null;
          original_statement: string;
          resolution_note: string | null;
          site_id: string;
          source_request_id: string | null;
          status: Database["public"]["Enums"]["service_case_status"];
          summary: string;
          triage_note: string | null;
          updated_at: string;
          updated_by: string;
          urgency: Database["public"]["Enums"]["request_urgency"];
          version: number;
        };
        SetofOptions: {
          from: "*";
          to: "service_cases";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      upsert_work_blocker: {
        Args: {
          p_actor_id: string;
          p_blocker_id: string;
          p_details: string;
          p_expected_version: number;
          p_instruction_item_id: string;
          p_job_id: string;
          p_kind: Database["public"]["Enums"]["work_blocker_kind"];
          p_next_review_date: string;
          p_organization_id: string;
          p_project_id: string;
          p_reason: Database["public"]["Enums"]["work_blocker_reason"];
          p_responsible_employee_record_id: string;
        };
        Returns: {
          blocker_id: string;
          blocker_version: number;
        }[];
      };
      upsert_work_dependency: {
        Args: {
          p_actor_id: string;
          p_declared_kind: Database["public"]["Enums"]["work_declared_dependency_kind"];
          p_dependency_id: string;
          p_dependent_job_id: string;
          p_dependent_project_id: string;
          p_description: string;
          p_effect: Database["public"]["Enums"]["work_dependency_effect"];
          p_expected_version: number;
          p_organization_id: string;
          p_predecessor_instruction_item_id: string;
          p_predecessor_job_id: string;
          p_predecessor_project_id: string;
        };
        Returns: {
          artifact_approval_action_id: string | null;
          created_at: string;
          created_by: string | null;
          declared_kind:
            | Database["public"]["Enums"]["work_declared_dependency_kind"]
            | null;
          dependent_job_id: string | null;
          dependent_project_id: string | null;
          description: string | null;
          effect: Database["public"]["Enums"]["work_dependency_effect"];
          id: string;
          manual_state:
            | Database["public"]["Enums"]["work_dependency_manual_state"]
            | null;
          organization_id: string;
          predecessor_instruction_item_id: string | null;
          predecessor_job_id: string | null;
          predecessor_project_id: string | null;
          removed_at: string | null;
          removed_by: string | null;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        SetofOptions: {
          from: "*";
          to: "work_dependencies";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      void_work_artifact: {
        Args: {
          p_action_id: string;
          p_actor_id: string;
          p_artifact_id: string;
          p_expected_version: number;
          p_organization_id: string;
          p_reason: string;
        };
        Returns: Json;
      };
      withdraw_customer_commitment: {
        Args: {
          p_actor_id: string;
          p_commitment_id: string;
          p_organization_id: string;
          p_reason: string;
        };
        Returns: undefined;
      };
      withdraw_work_handover: {
        Args: {
          p_actor_id: string;
          p_expected_execution_version: number;
          p_expected_package_version: number;
          p_organization_id: string;
          p_package_id: string;
          p_reason: string;
          p_request_id: string;
        };
        Returns: Json;
      };
      withdraw_work_handover_p1_17_inner: {
        Args: {
          p_actor_id: string;
          p_expected_execution_version: number;
          p_expected_package_version: number;
          p_organization_id: string;
          p_package_id: string;
          p_reason: string;
          p_request_id: string;
        };
        Returns: Json;
      };
    };
    Enums: {
      change_request_status: "pending" | "approved" | "rejected";
      client_type: "privat" | "gewerblich";
      customer_commitment_source:
        | "telefonisch"
        | "vor_ort"
        | "schriftlich_manuell"
        | "sonstige";
      customer_commitment_status: "active" | "superseded" | "withdrawn";
      dispatch_acknowledgement_state:
        | "acknowledged"
        | "challenged"
        | "carried_forward";
      dispatch_change_kind:
        | "issued"
        | "schedule_changed"
        | "reassigned"
        | "target_scheduled"
        | "instruction_changed"
        | "batch_reschedule";
      dispatch_status: "active" | "cancelled";
      entry_change_type: "edit" | "delete";
      installed_equipment_category:
        | "heat_generation"
        | "storage_and_hot_water"
        | "ventilation"
        | "solar_thermal"
        | "water_and_sanitary_system"
        | "system_component"
        | "other";
      installed_equipment_event_type:
        | "registered"
        | "details_corrected"
        | "installation_recorded"
        | "commissioning_recorded"
        | "warranty_recorded"
        | "activated"
        | "inactivated"
        | "removed"
        | "replaced"
        | "decommissioned"
        | "terminal_action_corrected"
        | "archived"
        | "archive_restored"
        | "work_linked"
        | "work_unlinked"
        | "source_linked"
        | "document_linked"
        | "document_unlinked";
      installed_equipment_identifier_type:
        | "serial_number"
        | "manufacturer_product_number"
        | "operator_equipment_number"
        | "other";
      installed_equipment_state:
        | "unknown"
        | "active"
        | "inactive"
        | "removed"
        | "replaced"
        | "decommissioned";
      installed_equipment_subtype:
        | "heat_pump"
        | "gas_boiler"
        | "oil_boiler"
        | "biomass_boiler"
        | "district_heat_interface"
        | "combined_heat_power"
        | "electric_heat_generator"
        | "other_heat_generator"
        | "domestic_hot_water_storage"
        | "buffer_storage"
        | "combined_storage"
        | "fresh_water_station"
        | "instantaneous_water_heater"
        | "domestic_hot_water_heat_pump"
        | "other_storage_or_hot_water"
        | "central_ventilation_with_heat_recovery"
        | "decentral_ventilation_with_heat_recovery"
        | "exhaust_air_ventilation"
        | "other_ventilation"
        | "water_treatment"
        | "pressure_boosting"
        | "wastewater_lifting"
        | "other_water_or_sanitary"
        | "indoor_unit"
        | "outdoor_unit"
        | "burner"
        | "pump"
        | "controller_or_gateway"
        | "collector"
        | "other_component";
      invite_status: "pending" | "accepted" | "expired" | "cancelled";
      job_priority: "niedrig" | "mittel" | "hoch";
      job_status: "nicht_bearbeitet" | "in_bearbeitung" | "fertig" | "geparkt";
      org_role: "admin" | "buero" | "employee";
      organization_responsibility:
        | "time_approval"
        | "leave_approval"
        | "work_artifact_approval"
        | "work_handover_review";
      planning_entry_kind: "job_visit" | "internal";
      planning_internal_type:
        | "internal_work"
        | "meeting"
        | "training"
        | "other";
      planning_occurrence_status: "scheduled" | "skipped" | "cancelled";
      planning_time_kind: "timed" | "all_day";
      project_status:
        | "nicht_begonnen"
        | "in_bearbeitung"
        | "abgeschlossen"
        | "geparkt";
      request_category:
        | "notfall"
        | "stoerung_reparatur"
        | "wartung"
        | "angebotsanfrage"
        | "installation_umbau"
        | "garantie_mangel"
        | "allgemeine_frage"
        | "sonstiges";
      request_close_reason:
        | "kein_bedarf"
        | "abgelehnt"
        | "duplikat"
        | "anderweitig_geloest"
        | "sonstiges";
      request_source: "telefon" | "email" | "vor_ort" | "sonstiges";
      request_status: "offen" | "in_klaerung" | "umgewandelt" | "geschlossen";
      request_urgency: "niedrig" | "normal" | "hoch" | "notfall";
      responsibility_assignment_source: "role_default" | "direct";
      responsibility_configuration_mode: "role_default" | "selected";
      service_case_charge_context:
        | "unknown"
        | "suspected_warranty"
        | "suspected_contract"
        | "suspected_goodwill"
        | "suspected_rework"
        | "expected_chargeable";
      service_case_event_type:
        | "created"
        | "triage_updated"
        | "status_changed"
        | "job_linked"
        | "job_unlinked"
        | "equipment_links_updated"
        | "relation_linked"
        | "evidence_linked"
        | "document_linked"
        | "document_unlinked";
      service_case_intake_type: "request" | "direct";
      service_case_relation_type:
        | "duplicate_of"
        | "related"
        | "continuation_of";
      service_case_status:
        | "new"
        | "clarification_needed"
        | "visit_required"
        | "follow_up_required"
        | "resolved"
        | "closed_without_visit"
        | "duplicate";
      subscription_status: "active" | "inactive" | "canceled" | "trialing";
      time_entry_status: "pending" | "approved" | "rejected" | "pending_delete";
      time_tracking_break_mode: "manual" | "automatic";
      work_artifact_action_type:
        | "review_requested"
        | "review_withdrawn"
        | "internal_approved"
        | "internal_rejected"
        | "correction_requested"
        | "customer_acknowledged"
        | "customer_refused"
        | "customer_reserved"
        | "signature_captured"
        | "exported"
        | "voided";
      work_artifact_change_authorization_state:
        | "not_requested"
        | "requested"
        | "authorized"
        | "rejected";
      work_artifact_defect_severity: "low" | "medium" | "high" | "critical";
      work_artifact_defect_state: "open" | "in_progress" | "resolved";
      work_artifact_document_relation:
        | "supporting_evidence"
        | "closure_proof"
        | "signature_mark"
        | "rendered_export";
      work_artifact_kind:
        | "site_diary"
        | "work_report"
        | "measurement"
        | "defect"
        | "change_work";
      work_artifact_measurement_unit:
        | "piece"
        | "meter"
        | "square_meter"
        | "cubic_meter"
        | "liter"
        | "kilogram"
        | "hour"
        | "flat_rate";
      work_artifact_status:
        | "draft"
        | "submitted"
        | "approved"
        | "rejected"
        | "correction_requested"
        | "voided";
      work_artifact_visibility: "internal_only" | "customer_facing";
      work_blocker_kind: "blocker" | "parking";
      work_blocker_reason:
        | "customer"
        | "material"
        | "approval"
        | "capacity"
        | "site_access"
        | "dependency"
        | "external_trade"
        | "safety"
        | "internal_clarification"
        | "other";
      work_blocker_state: "open" | "resolved";
      work_declared_dependency_kind:
        | "approval"
        | "delivery"
        | "site_condition"
        | "external_trade";
      work_dependency_effect: "blocks_start" | "blocks_completion" | "warning";
      work_dependency_manual_state: "open" | "satisfied" | "waived";
      work_execution_state:
        | "not_started"
        | "in_progress"
        | "interrupted"
        | "execution_complete"
        | "handed_over"
        | "cancelled";
      work_handover_commercial_readiness_state:
        | "not_ready"
        | "ready_for_commercial_review"
        | "ready_with_exceptions";
      work_handover_event_type:
        | "draft_saved"
        | "review_returned"
        | "release_reviewed"
        | "released"
        | "override_applied"
        | "handover_withdrawn"
        | "execution_reopened"
        | "successor_created";
      work_handover_package_state: "draft" | "released" | "reopened";
      work_handover_source_kind:
        | "work_artifact_revision"
        | "document_version"
        | "child_handover_release";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      change_request_status: ["pending", "approved", "rejected"],
      client_type: ["privat", "gewerblich"],
      customer_commitment_source: [
        "telefonisch",
        "vor_ort",
        "schriftlich_manuell",
        "sonstige",
      ],
      customer_commitment_status: ["active", "superseded", "withdrawn"],
      dispatch_acknowledgement_state: [
        "acknowledged",
        "challenged",
        "carried_forward",
      ],
      dispatch_change_kind: [
        "issued",
        "schedule_changed",
        "reassigned",
        "target_scheduled",
        "instruction_changed",
        "batch_reschedule",
      ],
      dispatch_status: ["active", "cancelled"],
      entry_change_type: ["edit", "delete"],
      installed_equipment_category: [
        "heat_generation",
        "storage_and_hot_water",
        "ventilation",
        "solar_thermal",
        "water_and_sanitary_system",
        "system_component",
        "other",
      ],
      installed_equipment_event_type: [
        "registered",
        "details_corrected",
        "installation_recorded",
        "commissioning_recorded",
        "warranty_recorded",
        "activated",
        "inactivated",
        "removed",
        "replaced",
        "decommissioned",
        "terminal_action_corrected",
        "archived",
        "archive_restored",
        "work_linked",
        "work_unlinked",
        "source_linked",
        "document_linked",
        "document_unlinked",
      ],
      installed_equipment_identifier_type: [
        "serial_number",
        "manufacturer_product_number",
        "operator_equipment_number",
        "other",
      ],
      installed_equipment_state: [
        "unknown",
        "active",
        "inactive",
        "removed",
        "replaced",
        "decommissioned",
      ],
      installed_equipment_subtype: [
        "heat_pump",
        "gas_boiler",
        "oil_boiler",
        "biomass_boiler",
        "district_heat_interface",
        "combined_heat_power",
        "electric_heat_generator",
        "other_heat_generator",
        "domestic_hot_water_storage",
        "buffer_storage",
        "combined_storage",
        "fresh_water_station",
        "instantaneous_water_heater",
        "domestic_hot_water_heat_pump",
        "other_storage_or_hot_water",
        "central_ventilation_with_heat_recovery",
        "decentral_ventilation_with_heat_recovery",
        "exhaust_air_ventilation",
        "other_ventilation",
        "water_treatment",
        "pressure_boosting",
        "wastewater_lifting",
        "other_water_or_sanitary",
        "indoor_unit",
        "outdoor_unit",
        "burner",
        "pump",
        "controller_or_gateway",
        "collector",
        "other_component",
      ],
      invite_status: ["pending", "accepted", "expired", "cancelled"],
      job_priority: ["niedrig", "mittel", "hoch"],
      job_status: ["nicht_bearbeitet", "in_bearbeitung", "fertig", "geparkt"],
      org_role: ["admin", "buero", "employee"],
      organization_responsibility: [
        "time_approval",
        "leave_approval",
        "work_artifact_approval",
        "work_handover_review",
      ],
      planning_entry_kind: ["job_visit", "internal"],
      planning_internal_type: ["internal_work", "meeting", "training", "other"],
      planning_occurrence_status: ["scheduled", "skipped", "cancelled"],
      planning_time_kind: ["timed", "all_day"],
      project_status: [
        "nicht_begonnen",
        "in_bearbeitung",
        "abgeschlossen",
        "geparkt",
      ],
      request_category: [
        "notfall",
        "stoerung_reparatur",
        "wartung",
        "angebotsanfrage",
        "installation_umbau",
        "garantie_mangel",
        "allgemeine_frage",
        "sonstiges",
      ],
      request_close_reason: [
        "kein_bedarf",
        "abgelehnt",
        "duplikat",
        "anderweitig_geloest",
        "sonstiges",
      ],
      request_source: ["telefon", "email", "vor_ort", "sonstiges"],
      request_status: ["offen", "in_klaerung", "umgewandelt", "geschlossen"],
      request_urgency: ["niedrig", "normal", "hoch", "notfall"],
      responsibility_assignment_source: ["role_default", "direct"],
      responsibility_configuration_mode: ["role_default", "selected"],
      service_case_charge_context: [
        "unknown",
        "suspected_warranty",
        "suspected_contract",
        "suspected_goodwill",
        "suspected_rework",
        "expected_chargeable",
      ],
      service_case_event_type: [
        "created",
        "triage_updated",
        "status_changed",
        "job_linked",
        "job_unlinked",
        "equipment_links_updated",
        "relation_linked",
        "evidence_linked",
        "document_linked",
        "document_unlinked",
      ],
      service_case_intake_type: ["request", "direct"],
      service_case_relation_type: [
        "duplicate_of",
        "related",
        "continuation_of",
      ],
      service_case_status: [
        "new",
        "clarification_needed",
        "visit_required",
        "follow_up_required",
        "resolved",
        "closed_without_visit",
        "duplicate",
      ],
      subscription_status: ["active", "inactive", "canceled", "trialing"],
      time_entry_status: ["pending", "approved", "rejected", "pending_delete"],
      time_tracking_break_mode: ["manual", "automatic"],
      work_artifact_action_type: [
        "review_requested",
        "review_withdrawn",
        "internal_approved",
        "internal_rejected",
        "correction_requested",
        "customer_acknowledged",
        "customer_refused",
        "customer_reserved",
        "signature_captured",
        "exported",
        "voided",
      ],
      work_artifact_change_authorization_state: [
        "not_requested",
        "requested",
        "authorized",
        "rejected",
      ],
      work_artifact_defect_severity: ["low", "medium", "high", "critical"],
      work_artifact_defect_state: ["open", "in_progress", "resolved"],
      work_artifact_document_relation: [
        "supporting_evidence",
        "closure_proof",
        "signature_mark",
        "rendered_export",
      ],
      work_artifact_kind: [
        "site_diary",
        "work_report",
        "measurement",
        "defect",
        "change_work",
      ],
      work_artifact_measurement_unit: [
        "piece",
        "meter",
        "square_meter",
        "cubic_meter",
        "liter",
        "kilogram",
        "hour",
        "flat_rate",
      ],
      work_artifact_status: [
        "draft",
        "submitted",
        "approved",
        "rejected",
        "correction_requested",
        "voided",
      ],
      work_artifact_visibility: ["internal_only", "customer_facing"],
      work_blocker_kind: ["blocker", "parking"],
      work_blocker_reason: [
        "customer",
        "material",
        "approval",
        "capacity",
        "site_access",
        "dependency",
        "external_trade",
        "safety",
        "internal_clarification",
        "other",
      ],
      work_blocker_state: ["open", "resolved"],
      work_declared_dependency_kind: [
        "approval",
        "delivery",
        "site_condition",
        "external_trade",
      ],
      work_dependency_effect: ["blocks_start", "blocks_completion", "warning"],
      work_dependency_manual_state: ["open", "satisfied", "waived"],
      work_execution_state: [
        "not_started",
        "in_progress",
        "interrupted",
        "execution_complete",
        "handed_over",
        "cancelled",
      ],
      work_handover_commercial_readiness_state: [
        "not_ready",
        "ready_for_commercial_review",
        "ready_with_exceptions",
      ],
      work_handover_event_type: [
        "draft_saved",
        "review_returned",
        "release_reviewed",
        "released",
        "override_applied",
        "handover_withdrawn",
        "execution_reopened",
        "successor_created",
      ],
      work_handover_package_state: ["draft", "released", "reopened"],
      work_handover_source_kind: [
        "work_artifact_revision",
        "document_version",
        "child_handover_release",
      ],
    },
  },
} as const;
