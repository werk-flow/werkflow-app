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
      attention_events: {
        Row: {
          created_at: string
          event_payload: Json
          event_type: string
          id: string
          organization_id: string
          source_id: string
          source_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_payload?: Json
          event_type: string
          id?: string
          organization_id: string
          source_id: string
          source_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_payload?: Json
          event_type?: string
          id?: string
          organization_id?: string
          source_id?: string
          source_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attention_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      attention_read_states: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          read_at: string
          source_id: string
          source_type: string
          state_version: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          read_at?: string
          source_id: string
          source_type: string
          state_version: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          read_at?: string
          source_id?: string
          source_type?: string
          state_version?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attention_read_states_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_contacts: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          is_active: boolean
          is_primary: boolean
          name: string
          notes: string | null
          organization_id: string
          phone: string | null
          role: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          is_primary?: boolean
          name: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          role?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          is_primary?: boolean
          name?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          role?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_contacts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_contacts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_request_events: {
        Row: {
          created_at: string
          created_by: string | null
          event_payload: Json
          event_type: string
          id: string
          organization_id: string
          request_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          event_payload?: Json
          event_type: string
          id?: string
          organization_id: string
          request_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          event_payload?: Json
          event_type?: string
          id?: string
          organization_id?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_request_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_request_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_request_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "client_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      client_requests: {
        Row: {
          assigned_to: string | null
          caller_address: string | null
          caller_email: string | null
          caller_name: string | null
          caller_phone: string | null
          category: Database["public"]["Enums"]["request_category"]
          client_id: string | null
          closed_at: string | null
          closed_by: string | null
          closed_note: string | null
          closed_reason:
            | Database["public"]["Enums"]["request_close_reason"]
            | null
          contact_id: string | null
          converted_at: string | null
          converted_by: string | null
          converted_job_id: string | null
          converted_project_id: string | null
          created_at: string
          created_by: string | null
          details: string | null
          id: string
          organization_id: string
          received_at: string
          request_number: string | null
          site_id: string | null
          source: Database["public"]["Enums"]["request_source"]
          status: Database["public"]["Enums"]["request_status"]
          summary: string
          updated_at: string
          urgency: Database["public"]["Enums"]["request_urgency"]
        }
        Insert: {
          assigned_to?: string | null
          caller_address?: string | null
          caller_email?: string | null
          caller_name?: string | null
          caller_phone?: string | null
          category?: Database["public"]["Enums"]["request_category"]
          client_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          closed_note?: string | null
          closed_reason?:
            | Database["public"]["Enums"]["request_close_reason"]
            | null
          contact_id?: string | null
          converted_at?: string | null
          converted_by?: string | null
          converted_job_id?: string | null
          converted_project_id?: string | null
          created_at?: string
          created_by?: string | null
          details?: string | null
          id?: string
          organization_id: string
          received_at?: string
          request_number?: string | null
          site_id?: string | null
          source?: Database["public"]["Enums"]["request_source"]
          status?: Database["public"]["Enums"]["request_status"]
          summary: string
          updated_at?: string
          urgency?: Database["public"]["Enums"]["request_urgency"]
        }
        Update: {
          assigned_to?: string | null
          caller_address?: string | null
          caller_email?: string | null
          caller_name?: string | null
          caller_phone?: string | null
          category?: Database["public"]["Enums"]["request_category"]
          client_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          closed_note?: string | null
          closed_reason?:
            | Database["public"]["Enums"]["request_close_reason"]
            | null
          contact_id?: string | null
          converted_at?: string | null
          converted_by?: string | null
          converted_job_id?: string | null
          converted_project_id?: string | null
          created_at?: string
          created_by?: string | null
          details?: string | null
          id?: string
          organization_id?: string
          received_at?: string
          request_number?: string | null
          site_id?: string | null
          source?: Database["public"]["Enums"]["request_source"]
          status?: Database["public"]["Enums"]["request_status"]
          summary?: string
          updated_at?: string
          urgency?: Database["public"]["Enums"]["request_urgency"]
        }
        Relationships: [
          {
            foreignKeyName: "client_requests_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_requests_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_requests_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "client_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_requests_converted_by_fkey"
            columns: ["converted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_requests_converted_job_id_fkey"
            columns: ["converted_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_requests_converted_project_id_fkey"
            columns: ["converted_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_requests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_requests_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "client_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      client_sites: {
        Row: {
          access_notes: string | null
          city: string | null
          client_id: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          is_primary: boolean
          name: string
          notes: string | null
          organization_id: string
          postal_code: string | null
          primary_contact_id: string | null
          street: string | null
          updated_at: string
        }
        Insert: {
          access_notes?: string | null
          city?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_primary?: boolean
          name: string
          notes?: string | null
          organization_id: string
          postal_code?: string | null
          primary_contact_id?: string | null
          street?: string | null
          updated_at?: string
        }
        Update: {
          access_notes?: string | null
          city?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_primary?: boolean
          name?: string
          notes?: string | null
          organization_id?: string
          postal_code?: string | null
          primary_contact_id?: string | null
          street?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_sites_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_sites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_sites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_sites_primary_contact_id_fkey"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "client_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address: string | null
          client_type: Database["public"]["Enums"]["client_type"]
          created_at: string
          customer_number: string | null
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
          customer_number?: string | null
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
          customer_number?: string | null
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
          request_id: string | null
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
          request_id?: string | null
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
          request_id?: string | null
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
          {
            foreignKeyName: "document_links_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "client_requests"
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
      email_change_challenges: {
        Row: {
          created_at: string
          current_email: string
          current_email_attempt_count: number
          current_email_code_expires_at: string | null
          current_email_code_hash: string | null
          current_email_last_sent_at: string | null
          current_email_verified_at: string | null
          current_email_verified_expires_at: string | null
          new_email: string | null
          new_email_attempt_count: number
          new_email_code_expires_at: string | null
          new_email_code_hash: string | null
          new_email_last_sent_at: string | null
          new_email_requested_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_email: string
          current_email_attempt_count?: number
          current_email_code_expires_at?: string | null
          current_email_code_hash?: string | null
          current_email_last_sent_at?: string | null
          current_email_verified_at?: string | null
          current_email_verified_expires_at?: string | null
          new_email?: string | null
          new_email_attempt_count?: number
          new_email_code_expires_at?: string | null
          new_email_code_hash?: string | null
          new_email_last_sent_at?: string | null
          new_email_requested_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_email?: string
          current_email_attempt_count?: number
          current_email_code_expires_at?: string | null
          current_email_code_hash?: string | null
          current_email_last_sent_at?: string | null
          current_email_verified_at?: string | null
          current_email_verified_expires_at?: string | null
          new_email?: string | null
          new_email_attempt_count?: number
          new_email_code_expires_at?: string | null
          new_email_code_hash?: string | null
          new_email_last_sent_at?: string | null
          new_email_requested_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      employee_record_events: {
        Row: {
          created_at: string
          created_by: string | null
          employee_record_id: string
          event_payload: Json
          event_type: string
          id: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          employee_record_id: string
          event_payload?: Json
          event_type: string
          id?: string
          organization_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          employee_record_id?: string
          event_payload?: Json
          event_type?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_record_events_employee_record_id_fkey"
            columns: ["employee_record_id"]
            isOneToOne: false
            referencedRelation: "employee_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_record_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_records: {
        Row: {
          city: string | null
          created_at: string
          created_by: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          employee_number: string | null
          entry_date: string | null
          exit_date: string | null
          first_name: string | null
          id: string
          invite_id: string | null
          last_name: string | null
          notes: string | null
          organization_id: string
          phone: string | null
          postal_code: string | null
          private_email: string | null
          street: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          city?: string | null
          created_at?: string
          created_by?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employee_number?: string | null
          entry_date?: string | null
          exit_date?: string | null
          first_name?: string | null
          id?: string
          invite_id?: string | null
          last_name?: string | null
          notes?: string | null
          organization_id: string
          phone?: string | null
          postal_code?: string | null
          private_email?: string | null
          street?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          city?: string | null
          created_at?: string
          created_by?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employee_number?: string | null
          entry_date?: string | null
          exit_date?: string | null
          first_name?: string | null
          id?: string
          invite_id?: string | null
          last_name?: string | null
          notes?: string | null
          organization_id?: string
          phone?: string | null
          postal_code?: string | null
          private_email?: string | null
          street?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_records_invite_id_fkey"
            columns: ["invite_id"]
            isOneToOne: false
            referencedRelation: "organization_invites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employment_conditions: {
        Row: {
          created_at: string
          created_by: string | null
          employee_record_id: string
          employment_type: string
          id: string
          note: string | null
          organization_id: string
          updated_at: string
          vacation_days_per_year: number | null
          valid_from: string
          weekly_hours: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          employee_record_id: string
          employment_type: string
          id?: string
          note?: string | null
          organization_id: string
          updated_at?: string
          vacation_days_per_year?: number | null
          valid_from: string
          weekly_hours?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          employee_record_id?: string
          employment_type?: string
          id?: string
          note?: string | null
          organization_id?: string
          updated_at?: string
          vacation_days_per_year?: number | null
          valid_from?: string
          weekly_hours?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "employment_conditions_employee_record_id_fkey"
            columns: ["employee_record_id"]
            isOneToOne: false
            referencedRelation: "employee_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employment_conditions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      inventory_asset_instances: {
        Row: {
          asset_tag: string | null
          assigned_to_user_id: string | null
          created_at: string
          current_job_id: string | null
          current_location_id: string | null
          id: string
          item_id: string
          notes: string | null
          organization_id: string
          purchased_at: string | null
          serial_number: string | null
          status: string
          updated_at: string
        }
        Insert: {
          asset_tag?: string | null
          assigned_to_user_id?: string | null
          created_at?: string
          current_job_id?: string | null
          current_location_id?: string | null
          id?: string
          item_id: string
          notes?: string | null
          organization_id: string
          purchased_at?: string | null
          serial_number?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          asset_tag?: string | null
          assigned_to_user_id?: string | null
          created_at?: string
          current_job_id?: string | null
          current_location_id?: string | null
          id?: string
          item_id?: string
          notes?: string | null
          organization_id?: string
          purchased_at?: string | null
          serial_number?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_asset_instances_assigned_to_user_id_fkey"
            columns: ["assigned_to_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_asset_instances_current_job_id_fkey"
            columns: ["current_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_asset_instances_current_location_id_fkey"
            columns: ["current_location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_asset_instances_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_asset_instances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_audit_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_payload: Json
          event_type: string
          id: string
          item_id: string | null
          location_id: string | null
          organization_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_payload?: Json
          event_type: string
          id?: string
          item_id?: string | null
          location_id?: string | null
          organization_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_payload?: Json
          event_type?: string
          id?: string
          item_id?: string | null
          location_id?: string | null
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_audit_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_audit_events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_audit_events_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_system_default: boolean
          name: string
          organization_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_system_default?: boolean
          name: string
          organization_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_system_default?: boolean
          name?: string
          organization_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_import_batches: {
        Row: {
          column_mapping: Json
          completed_at: string | null
          created_at: string
          created_by: string | null
          failed_count: number
          file_name: string
          id: string
          imported_count: number
          organization_id: string
          row_count: number
          status: string
        }
        Insert: {
          column_mapping?: Json
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          failed_count?: number
          file_name: string
          id?: string
          imported_count?: number
          organization_id: string
          row_count?: number
          status?: string
        }
        Update: {
          column_mapping?: Json
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          failed_count?: number
          file_name?: string
          id?: string
          imported_count?: number
          organization_id?: string
          row_count?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_import_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_import_batches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_item_barcodes: {
        Row: {
          barcode_type: string
          barcode_value: string
          created_at: string
          id: string
          is_primary: boolean
          item_id: string
          organization_id: string
        }
        Insert: {
          barcode_type?: string
          barcode_value: string
          created_at?: string
          id?: string
          is_primary?: boolean
          item_id: string
          organization_id: string
        }
        Update: {
          barcode_type?: string
          barcode_value?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          item_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_item_barcodes_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_item_barcodes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          category_id: string | null
          created_at: string
          created_by: string | null
          currency_code: string
          description: string | null
          global_minimum_stock: number
          global_target_stock: number | null
          id: string
          internal_sku: string | null
          is_active: boolean
          is_billable: boolean
          item_type: string
          manufacturer: string | null
          name: string
          notes: string | null
          organization_id: string
          purchase_price_cents: number | null
          sale_price_cents: number | null
          supplier_article_number: string | null
          supplier_id: string | null
          tax_rate_basis_points: number
          track_individual_assets: boolean
          track_quantity: boolean
          unit: string
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string
          description?: string | null
          global_minimum_stock?: number
          global_target_stock?: number | null
          id?: string
          internal_sku?: string | null
          is_active?: boolean
          is_billable?: boolean
          item_type?: string
          manufacturer?: string | null
          name: string
          notes?: string | null
          organization_id: string
          purchase_price_cents?: number | null
          sale_price_cents?: number | null
          supplier_article_number?: string | null
          supplier_id?: string | null
          tax_rate_basis_points?: number
          track_individual_assets?: boolean
          track_quantity?: boolean
          unit?: string
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string
          description?: string | null
          global_minimum_stock?: number
          global_target_stock?: number | null
          id?: string
          internal_sku?: string | null
          is_active?: boolean
          is_billable?: boolean
          item_type?: string
          manufacturer?: string | null
          name?: string
          notes?: string | null
          organization_id?: string
          purchase_price_cents?: number | null
          sale_price_cents?: number | null
          supplier_article_number?: string | null
          supplier_id?: string | null
          tax_rate_basis_points?: number
          track_individual_assets?: boolean
          track_quantity?: boolean
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "inventory_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "inventory_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_locations: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          location_type: string
          name: string
          organization_id: string
          parent_location_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          location_type?: string
          name: string
          organization_id: string
          parent_location_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          location_type?: string
          name?: string
          organization_id?: string
          parent_location_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_locations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_locations_parent_location_id_fkey"
            columns: ["parent_location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          actor_id: string | null
          created_at: string
          id: string
          import_batch_id: string | null
          item_id: string
          job_id: string | null
          job_material_line_id: string | null
          location_id: string
          movement_type: string
          organization_id: string
          project_id: string | null
          quantity_after: number
          quantity_before: number
          quantity_delta: number
          reason: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: string
          import_batch_id?: string | null
          item_id: string
          job_id?: string | null
          job_material_line_id?: string | null
          location_id: string
          movement_type: string
          organization_id: string
          project_id?: string | null
          quantity_after: number
          quantity_before: number
          quantity_delta: number
          reason?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: string
          import_batch_id?: string | null
          item_id?: string
          job_id?: string | null
          job_material_line_id?: string | null
          location_id?: string
          movement_type?: string
          organization_id?: string
          project_id?: string | null
          quantity_after?: number
          quantity_before?: number
          quantity_delta?: number
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "inventory_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_job_material_line_id_fkey"
            columns: ["job_material_line_id"]
            isOneToOne: false
            referencedRelation: "job_material_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_stock_levels: {
        Row: {
          id: string
          item_id: string
          location_id: string
          organization_id: string
          quantity_on_hand: number
          updated_at: string
        }
        Insert: {
          id?: string
          item_id: string
          location_id: string
          organization_id: string
          quantity_on_hand?: number
          updated_at?: string
        }
        Update: {
          id?: string
          item_id?: string
          location_id?: string
          organization_id?: string
          quantity_on_hand?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_stock_levels_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_stock_levels_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_stock_levels_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_suppliers: {
        Row: {
          created_at: string
          customer_number: string | null
          email: string | null
          id: string
          name: string
          notes: string | null
          organization_id: string
          phone: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          created_at?: string
          customer_number?: string | null
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          created_at?: string
          customer_number?: string | null
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_suppliers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      job_material_lines: {
        Row: {
          billable_quantity: number
          created_at: string
          created_by: string | null
          id: string
          is_billable: boolean
          is_unplanned: boolean
          item_id: string
          job_id: string | null
          notes: string | null
          organization_id: string
          planned_quantity: number
          preferred_location_id: string | null
          project_id: string | null
          returned_quantity: number
          status: string
          taken_quantity: number
          updated_at: string
        }
        Insert: {
          billable_quantity?: number
          created_at?: string
          created_by?: string | null
          id?: string
          is_billable?: boolean
          is_unplanned?: boolean
          item_id: string
          job_id?: string | null
          notes?: string | null
          organization_id: string
          planned_quantity?: number
          preferred_location_id?: string | null
          project_id?: string | null
          returned_quantity?: number
          status?: string
          taken_quantity?: number
          updated_at?: string
        }
        Update: {
          billable_quantity?: number
          created_at?: string
          created_by?: string | null
          id?: string
          is_billable?: boolean
          is_unplanned?: boolean
          item_id?: string
          job_id?: string | null
          notes?: string | null
          organization_id?: string
          planned_quantity?: number
          preferred_location_id?: string | null
          project_id?: string | null
          returned_quantity?: number
          status?: string
          taken_quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_material_lines_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_material_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_material_lines_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_material_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_material_lines_preferred_location_id_fkey"
            columns: ["preferred_location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_material_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          actual_completion_date: string | null
          client_id: string | null
          contact_id: string | null
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
          site_id: string | null
          status: Database["public"]["Enums"]["job_status"]
          title: string
          updated_at: string
        }
        Insert: {
          actual_completion_date?: string | null
          client_id?: string | null
          contact_id?: string | null
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
          site_id?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          title: string
          updated_at?: string
        }
        Update: {
          actual_completion_date?: string | null
          client_id?: string | null
          contact_id?: string | null
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
          site_id?: string | null
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
            foreignKeyName: "jobs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "client_contacts"
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
          {
            foreignKeyName: "jobs_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "client_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_closure_days: {
        Row: {
          closure_date: string
          created_at: string
          created_by: string | null
          id: string
          label: string | null
          organization_id: string
        }
        Insert: {
          closure_date: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          organization_id: string
        }
        Update: {
          closure_date?: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_closure_days_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      organization_responsibility_assignments: {
        Row: {
          configuration_id: string
          created_at: string
          employee_record_id: string
          id: string
          organization_id: string
          role_snapshot: Database["public"]["Enums"]["org_role"] | null
          source: Database["public"]["Enums"]["responsibility_assignment_source"]
        }
        Insert: {
          configuration_id: string
          created_at?: string
          employee_record_id: string
          id?: string
          organization_id: string
          role_snapshot?: Database["public"]["Enums"]["org_role"] | null
          source: Database["public"]["Enums"]["responsibility_assignment_source"]
        }
        Update: {
          configuration_id?: string
          created_at?: string
          employee_record_id?: string
          id?: string
          organization_id?: string
          role_snapshot?: Database["public"]["Enums"]["org_role"] | null
          source?: Database["public"]["Enums"]["responsibility_assignment_source"]
        }
        Relationships: [
          {
            foreignKeyName: "organization_responsibility_assignments_configuration_id_fkey"
            columns: ["configuration_id"]
            isOneToOne: false
            referencedRelation: "organization_responsibility_configurations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_responsibility_assignments_employee_record_id_fkey"
            columns: ["employee_record_id"]
            isOneToOne: false
            referencedRelation: "employee_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_responsibility_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_responsibility_configurations: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          id: string
          mode: Database["public"]["Enums"]["responsibility_configuration_mode"]
          organization_id: string
          responsibility: Database["public"]["Enums"]["organization_responsibility"]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          id?: string
          mode: Database["public"]["Enums"]["responsibility_configuration_mode"]
          organization_id: string
          responsibility: Database["public"]["Enums"]["organization_responsibility"]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          id?: string
          mode?: Database["public"]["Enums"]["responsibility_configuration_mode"]
          organization_id?: string
          responsibility?: Database["public"]["Enums"]["organization_responsibility"]
        }
        Relationships: [
          {
            foreignKeyName: "organization_responsibility_configurations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_responsibility_delegations: {
        Row: {
          created_at: string
          created_by: string | null
          delegator_employee_record_id: string
          id: string
          note: string | null
          organization_id: string
          responsibility: Database["public"]["Enums"]["organization_responsibility"]
          revoked_from: string | null
          substitute_employee_record_id: string
          updated_at: string
          valid_from: string
          valid_until: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delegator_employee_record_id: string
          id?: string
          note?: string | null
          organization_id: string
          responsibility: Database["public"]["Enums"]["organization_responsibility"]
          revoked_from?: string | null
          substitute_employee_record_id: string
          updated_at?: string
          valid_from: string
          valid_until: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delegator_employee_record_id?: string
          id?: string
          note?: string | null
          organization_id?: string
          responsibility?: Database["public"]["Enums"]["organization_responsibility"]
          revoked_from?: string | null
          substitute_employee_record_id?: string
          updated_at?: string
          valid_from?: string
          valid_until?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_responsibility_d_delegator_employee_record_id_fkey"
            columns: ["delegator_employee_record_id"]
            isOneToOne: false
            referencedRelation: "employee_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_responsibility_d_substitute_employee_record_i_fkey"
            columns: ["substitute_employee_record_id"]
            isOneToOne: false
            referencedRelation: "employee_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_responsibility_delegations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_responsibility_events: {
        Row: {
          configuration_id: string | null
          created_at: string
          created_by: string | null
          delegation_id: string | null
          event_payload: Json
          event_type: string
          id: string
          organization_id: string
          primary_employee_record_id: string | null
          related_employee_record_id: string | null
          responsibility: Database["public"]["Enums"]["organization_responsibility"]
        }
        Insert: {
          configuration_id?: string | null
          created_at?: string
          created_by?: string | null
          delegation_id?: string | null
          event_payload?: Json
          event_type: string
          id?: string
          organization_id: string
          primary_employee_record_id?: string | null
          related_employee_record_id?: string | null
          responsibility: Database["public"]["Enums"]["organization_responsibility"]
        }
        Update: {
          configuration_id?: string | null
          created_at?: string
          created_by?: string | null
          delegation_id?: string | null
          event_payload?: Json
          event_type?: string
          id?: string
          organization_id?: string
          primary_employee_record_id?: string | null
          related_employee_record_id?: string | null
          responsibility?: Database["public"]["Enums"]["organization_responsibility"]
        }
        Relationships: [
          {
            foreignKeyName: "organization_responsibility_eve_primary_employee_record_id_fkey"
            columns: ["primary_employee_record_id"]
            isOneToOne: false
            referencedRelation: "employee_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_responsibility_eve_related_employee_record_id_fkey"
            columns: ["related_employee_record_id"]
            isOneToOne: false
            referencedRelation: "employee_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_responsibility_events_configuration_id_fkey"
            columns: ["configuration_id"]
            isOneToOne: false
            referencedRelation: "organization_responsibility_configurations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_responsibility_events_delegation_id_fkey"
            columns: ["delegation_id"]
            isOneToOne: false
            referencedRelation: "organization_responsibility_delegations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_responsibility_events_organization_id_fkey"
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
          holiday_region: string | null
          holiday_region_history: Json
          organization_id: string
          updated_at: string
        }
        Insert: {
          auto_break_duration_minutes?: number
          auto_break_threshold_minutes?: number
          break_mode?: Database["public"]["Enums"]["time_tracking_break_mode"]
          break_policy_history?: Json
          created_at?: string
          holiday_region?: string | null
          holiday_region_history?: Json
          organization_id: string
          updated_at?: string
        }
        Update: {
          auto_break_duration_minutes?: number
          auto_break_threshold_minutes?: number
          break_mode?: Database["public"]["Enums"]["time_tracking_break_mode"]
          break_policy_history?: Json
          created_at?: string
          holiday_region?: string | null
          holiday_region_history?: Json
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
          contact_id: string | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          name: string
          organization_id: string
          planned_end_date: string | null
          planned_start_date: string | null
          project_number: string | null
          site_id: string | null
          status_override: Database["public"]["Enums"]["project_status"] | null
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          name: string
          organization_id: string
          planned_end_date?: string | null
          planned_start_date?: string | null
          project_number?: string | null
          site_id?: string | null
          status_override?: Database["public"]["Enums"]["project_status"] | null
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          planned_end_date?: string | null
          planned_start_date?: string | null
          project_number?: string | null
          site_id?: string | null
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
            foreignKeyName: "projects_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "client_contacts"
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
          {
            foreignKeyName: "projects_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "client_sites"
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
      vacation_request_events: {
        Row: {
          created_at: string
          created_by: string | null
          employee_record_id: string
          event_payload: Json
          event_type: string
          id: string
          organization_id: string
          vacation_request_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          employee_record_id: string
          event_payload?: Json
          event_type: string
          id?: string
          organization_id: string
          vacation_request_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          employee_record_id?: string
          event_payload?: Json
          event_type?: string
          id?: string
          organization_id?: string
          vacation_request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vacation_request_events_employee_record_id_fkey"
            columns: ["employee_record_id"]
            isOneToOne: false
            referencedRelation: "employee_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacation_request_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacation_request_events_vacation_request_id_fkey"
            columns: ["vacation_request_id"]
            isOneToOne: false
            referencedRelation: "vacation_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      vacation_requests: {
        Row: {
          approved_days_by_year: Json | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          comment: string | null
          created_at: string
          day_portion: string
          decided_at: string | null
          decided_by: string | null
          decision_comment: string | null
          employee_record_id: string
          end_date: string
          id: string
          organization_id: string
          requested_by: string | null
          start_date: string
          status: string
          updated_at: string
        }
        Insert: {
          approved_days_by_year?: Json | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          comment?: string | null
          created_at?: string
          day_portion?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_comment?: string | null
          employee_record_id: string
          end_date: string
          id?: string
          organization_id: string
          requested_by?: string | null
          start_date: string
          status?: string
          updated_at?: string
        }
        Update: {
          approved_days_by_year?: Json | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          comment?: string | null
          created_at?: string
          day_portion?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_comment?: string | null
          employee_record_id?: string
          end_date?: string
          id?: string
          organization_id?: string
          requested_by?: string | null
          start_date?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vacation_requests_employee_record_id_fkey"
            columns: ["employee_record_id"]
            isOneToOne: false
            referencedRelation: "employee_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacation_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      work_schedules: {
        Row: {
          created_at: string
          created_by: string | null
          employee_record_id: string
          friday_minutes: number
          id: string
          monday_minutes: number
          note: string | null
          organization_id: string
          saturday_minutes: number
          sunday_minutes: number
          thursday_minutes: number
          tuesday_minutes: number
          updated_at: string
          valid_from: string
          wednesday_minutes: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          employee_record_id: string
          friday_minutes?: number
          id?: string
          monday_minutes?: number
          note?: string | null
          organization_id: string
          saturday_minutes?: number
          sunday_minutes?: number
          thursday_minutes?: number
          tuesday_minutes?: number
          updated_at?: string
          valid_from: string
          wednesday_minutes?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          employee_record_id?: string
          friday_minutes?: number
          id?: string
          monday_minutes?: number
          note?: string | null
          organization_id?: string
          saturday_minutes?: number
          sunday_minutes?: number
          thursday_minutes?: number
          tuesday_minutes?: number
          updated_at?: string
          valid_from?: string
          wednesday_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "work_schedules_employee_record_id_fkey"
            columns: ["employee_record_id"]
            isOneToOne: false
            referencedRelation: "employee_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_schedules_organization_id_fkey"
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
      apply_responsibility_configuration: {
        Args: {
          p_actor_id: string
          p_employee_record_ids: string[]
          p_expected_configuration_id: string
          p_mode: Database["public"]["Enums"]["responsibility_configuration_mode"]
          p_organization_id: string
          p_responsibility: Database["public"]["Enums"]["organization_responsibility"]
        }
        Returns: string
      }
      check_user_exists_by_email: {
        Args: { p_email: string }
        Returns: {
          user_exists: boolean
          user_id: string
        }[]
      }
      create_responsibility_delegation: {
        Args: {
          p_actor_id: string
          p_delegator_employee_record_id: string
          p_note: string
          p_organization_id: string
          p_responsibility: Database["public"]["Enums"]["organization_responsibility"]
          p_substitute_employee_record_id: string
          p_valid_from: string
          p_valid_until: string
        }
        Returns: string
      }
      end_responsibility_delegation: {
        Args: {
          p_actor_id: string
          p_delegation_id: string
          p_revoked_from: string
        }
        Returns: undefined
      }
      ensure_inventory_defaults: {
        Args: { p_actor_id: string; p_org_id: string }
        Returns: undefined
      }
      generate_job_number: { Args: { p_org_id: string }; Returns: string }
      generate_personnel_number: { Args: { p_org_id: string }; Returns: string }
      generate_project_number: { Args: { p_org_id: string }; Returns: string }
      generate_request_number: { Args: { p_org_id: string }; Returns: string }
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
          customer_number: string | null
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
      get_org_members_for_user: {
        Args: { p_org_id: string; p_user_id: string }
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
      record_inventory_movement: {
        Args: {
          p_actor_id: string
          p_import_batch_id?: string
          p_item_id: string
          p_job_id?: string
          p_job_material_line_id?: string
          p_location_id: string
          p_movement_type: string
          p_organization_id: string
          p_project_id?: string
          p_quantity_delta: number
          p_reason?: string
        }
        Returns: {
          movement_id: string
          quantity_after: number
          quantity_before: number
        }[]
      }
      redeem_organization_invite: {
        Args: { p_invite_code: string }
        Returns: {
          already_member: boolean
          org_id: string
          org_name: string
        }[]
      }
      redeem_organization_invite_for_user: {
        Args: { p_invite_code: string; p_user_id: string }
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
      organization_responsibility: "time_approval" | "leave_approval"
      project_status:
        | "nicht_begonnen"
        | "in_bearbeitung"
        | "abgeschlossen"
        | "geparkt"
      request_category:
        | "notfall"
        | "stoerung_reparatur"
        | "wartung"
        | "angebotsanfrage"
        | "installation_umbau"
        | "garantie_mangel"
        | "allgemeine_frage"
        | "sonstiges"
      request_close_reason:
        | "kein_bedarf"
        | "abgelehnt"
        | "duplikat"
        | "anderweitig_geloest"
        | "sonstiges"
      request_source: "telefon" | "email" | "vor_ort" | "sonstiges"
      request_status: "offen" | "in_klaerung" | "umgewandelt" | "geschlossen"
      request_urgency: "niedrig" | "normal" | "hoch" | "notfall"
      responsibility_assignment_source: "role_default" | "direct"
      responsibility_configuration_mode: "role_default" | "selected"
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
      organization_responsibility: ["time_approval", "leave_approval"],
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
      subscription_status: ["active", "inactive", "canceled", "trialing"],
      time_entry_status: ["pending", "approved", "rejected", "pending_delete"],
      time_tracking_break_mode: ["manual", "automatic"],
    },
  },
} as const
