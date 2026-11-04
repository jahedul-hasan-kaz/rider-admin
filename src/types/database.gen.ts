export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  api: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_offer: { Args: { p_offer_id: string }; Returns: Json };
      acknowledge_alert: { Args: { p_id: string; p_note: string }; Returns: undefined };
      add_trip_note: { Args: { p_body: string; p_trip_id: string }; Returns: undefined };
      admin_assign_driver: {
        Args: { p_driver_id: string; p_reason: string; p_request_id: string };
        Returns: Json;
      };
      admin_book_ride: {
        Args: {
          p_category_id: string;
          p_destination_label: string;
          p_destination_lat: number;
          p_destination_lng: number;
          p_distance_m: number;
          p_duration_s: number;
          p_passenger_id: string;
          p_payment_method: Database["public"]["Enums"]["payment_method"];
          p_pickup_label: string;
          p_pickup_lat: number;
          p_pickup_lng: number;
          p_pickup_note: string;
          p_reason: string;
        };
        Returns: Json;
      };
      admin_cancel_request: { Args: { p_reason: string; p_request_id: string }; Returns: Json };
      admin_cancel_trip: { Args: { p_reason: string; p_trip_id: string }; Returns: Json };
      admin_complete_document: {
        Args: {
          p_document_id: string;
          p_document_number: string;
          p_expires_at: string;
          p_issued_at: string;
          p_reason: string;
          p_sha256: string;
          p_size_bytes: number;
        };
        Returns: Json;
      };
      admin_confirm_cash: {
        Args: { p_amount: number; p_reason: string; p_trip_id: string };
        Returns: Json;
      };
      admin_create_alert: {
        Args: { p_audience?: string; p_detail: string; p_severity: string; p_title: string };
        Returns: Json;
      };
      admin_create_document: {
        Args: {
          p_content_type: string;
          p_document_type: Database["public"]["Enums"]["document_type"];
          p_driver_id: string;
          p_size_bytes: number;
          p_vehicle_id: string;
        };
        Returns: Json;
      };
      admin_delete_account: { Args: { p_reason: string; p_user_id: string }; Returns: Json };
      admin_find_unused_account: { Args: { p_email: string }; Returns: string };
      admin_pick_people: { Args: { p_query: string; p_role: string }; Returns: Json };
      admin_retire_vehicle: { Args: { p_id: string; p_reason: string }; Returns: Json };
      admin_save_vehicle: {
        Args: {
          p_category_id: string;
          p_color: string;
          p_driver_id: string;
          p_id: string;
          p_make: string;
          p_model: string;
          p_reason: string;
          p_registration_number: string;
          p_year: number;
        };
        Returns: Json;
      };
      admin_setup_account: {
        Args: {
          p_full_name: string;
          p_home_zone_id: string;
          p_phone: string;
          p_reason: string;
          p_role: string;
          p_user_id: string;
        };
        Returns: Json;
      };
      admin_update_contact: {
        Args: { p_full_name: string; p_phone: string; p_profile_id: string; p_reason: string };
        Returns: Json;
      };
      admin_update_document: {
        Args: { p_expires_at: string; p_id: string; p_issued_at: string; p_reason: string };
        Returns: Json;
      };
      admin_update_request: {
        Args: { p_pickup_note: string; p_reason: string; p_request_id: string };
        Returns: Json;
      };
      admin_withdraw_document: { Args: { p_id: string; p_reason: string }; Returns: Json };
      advance_incident: {
        Args: { p_escalated_to?: string; p_id: string; p_note: string; p_status: string };
        Returns: Json;
      };
      analytics: {
        Args: {
          p_category?: string;
          p_from: string;
          p_page: string;
          p_to: string;
          p_zone?: string;
        };
        Returns: Json;
      };
      apply_admin_permission_changes: {
        Args: {
          p_add_templates: string[];
          p_admin_id: string;
          p_overrides: Json;
          p_reason: string;
          p_remove_templates: string[];
        };
        Returns: Json;
      };
      apply_promo: { Args: { p_code: string; p_request_id: string }; Returns: Json };
      approve_driver: { Args: { p_driver_id: string; p_reason: string }; Returns: Json };
      approve_payout_batch: { Args: { p_id: string }; Returns: Json };
      assign_permission_template: {
        Args: { p_admin_id: string; p_reason: string; p_template_id: string };
        Returns: undefined;
      };
      assign_ticket: { Args: { p_assignee: string; p_id: string }; Returns: Json };
      assign_tickets: { Args: { p_assignee: string; p_ids: string[] }; Returns: number };
      cancel_admin_invitation: {
        Args: { p_invitation_id: string; p_reason: string };
        Returns: undefined;
      };
      cancel_payout_batch: { Args: { p_id: string; p_reason: string }; Returns: undefined };
      cancel_preview: { Args: { p_request_id: string }; Returns: Json };
      cancel_refund_request: { Args: { p_id: string }; Returns: undefined };
      cancel_ride: { Args: { p_reason: string; p_request_id: string }; Returns: Json };
      check_rate_limit: {
        Args: { p_class: string; p_limit: number; p_window_s: number };
        Returns: number;
      };
      check_zone: { Args: { p_lat: number; p_lng: number }; Returns: Json };
      claim_archive_exports: { Args: { p_limit?: number }; Returns: Json };
      claim_exports_for_storage: { Args: { p_limit?: number }; Returns: Json };
      claim_notifications: { Args: { p_limit?: number }; Returns: Json };
      claim_storage_purges: { Args: { p_limit?: number }; Returns: Json };
      clear_permission_override: {
        Args: { p_admin_id: string; p_permission: string; p_reason: string };
        Returns: undefined;
      };
      client_config: { Args: Record<PropertyKey, never>; Returns: Json };
      clone_fare_rule: { Args: { p_rule_id: string }; Returns: string };
      complete_evidence_upload: {
        Args: {
          p_content_type: string;
          p_description?: string;
          p_incident_id: string;
          p_path: string;
          p_sha256: string;
          p_size: number;
        };
        Returns: Json;
      };
      complete_trip: { Args: { p_trip_id: string }; Returns: Json };
      confirm_cash_collected: { Args: { p_amount?: number; p_trip_id: string }; Returns: Json };
      create_payout_batch: { Args: { p_notes?: string }; Returns: Json };
      create_permission_template: {
        Args: {
          p_code: string;
          p_description: string;
          p_name: string;
          p_permissions: string[];
          p_reason: string;
        };
        Returns: string;
      };
      create_quote: {
        Args: {
          p_category_id: string;
          p_destination_label: string;
          p_destination_lat: number;
          p_destination_lng: number;
          p_distance_m: number;
          p_duration_s: number;
          p_pickup_label: string;
          p_pickup_lat: number;
          p_pickup_lng: number;
        };
        Returns: Json;
      };
      create_ride_request: {
        Args: {
          p_payment_method: Database["public"]["Enums"]["payment_method"];
          p_pickup_note: string;
          p_quote_id: string;
        };
        Returns: Json;
      };
      create_ticket: {
        Args: { p_body: string; p_category: string; p_subject: string; p_trip_id: string };
        Returns: Json;
      };
      dashboard: {
        Args: { p_category?: string; p_from: string; p_to: string; p_zone?: string };
        Returns: Json;
      };
      delete_permission_template: {
        Args: { p_reason: string; p_template_id: string };
        Returns: undefined;
      };
      delete_view: { Args: { p_id: string }; Returns: undefined };
      demo_seed: { Args: { p_arg?: Json; p_batch?: number; p_phase: string }; Returns: Json };
      discard_fare_draft: { Args: { p_reason: string; p_rule_id: string }; Returns: undefined };
      driver_add_vehicle: {
        Args: {
          p_category_id: string;
          p_color: string;
          p_make: string;
          p_model: string;
          p_registration_number: string;
          p_year: number;
        };
        Returns: Json;
      };
      driver_complete_document: {
        Args: {
          p_document_id: string;
          p_document_number: string;
          p_expires_at: string;
          p_issued_at: string;
          p_sha256: string;
          p_size_bytes: number;
        };
        Returns: Json;
      };
      driver_create_document: {
        Args: {
          p_content_type: string;
          p_document_type: Database["public"]["Enums"]["document_type"];
          p_size_bytes: number;
          p_vehicle_id: string;
        };
        Returns: Json;
      };
      driver_current_offer: { Args: Record<PropertyKey, never>; Returns: Json };
      driver_current_trip: { Args: Record<PropertyKey, never>; Returns: Json };
      driver_earnings: { Args: { p_cursor?: string; p_limit?: number }; Returns: Json };
      driver_onboarding_state: { Args: Record<PropertyKey, never>; Returns: Json };
      driver_set_availability: {
        Args: { p_accuracy_m?: number; p_lat: number; p_lng: number; p_online: boolean };
        Returns: Json;
      };
      driver_set_payout_account: {
        Args: { p_holder: string; p_method: string; p_ref: string };
        Returns: Json;
      };
      driver_submit_application: { Args: Record<PropertyKey, never>; Returns: Json };
      driver_trip_arrived: { Args: { p_override?: boolean; p_trip_id: string }; Returns: Json };
      driver_trip_arriving: { Args: { p_trip_id: string }; Returns: Json };
      driver_trip_cancel: { Args: { p_reason: string; p_trip_id: string }; Returns: Json };
      driver_trip_start: { Args: { p_pin?: string; p_trip_id: string }; Returns: Json };
      driver_update_details: {
        Args: { p_home_zone_id: string; p_licence_expiry: string; p_licence_number: string };
        Returns: Json;
      };
      driver_update_location: {
        Args: {
          p_accuracy_m: number;
          p_heading: number;
          p_lat: number;
          p_lng: number;
          p_recorded_at: string;
          p_speed_mps: number;
        };
        Returns: Json;
      };
      driver_update_locations: { Args: { p_points: Json }; Returns: Json };
      driver_update_vehicle: {
        Args: {
          p_category_id: string;
          p_color: string;
          p_expected_version: number;
          p_make: string;
          p_model: string;
          p_registration_number: string;
          p_vehicle_id: string;
          p_year: number;
        };
        Returns: Json;
      };
      driver_wallet: { Args: Record<PropertyKey, never>; Returns: Json };
      expire_request: { Args: { p_reason: string; p_request_id: string }; Returns: Json };
      fail_payout: { Args: { p_payout_id: string; p_reason: string }; Returns: Json };
      finish_archive_export: {
        Args: {
          p_bytes: number;
          p_path: string;
          p_rows: number;
          p_run_id: number;
          p_sha256: string;
        };
        Returns: undefined;
      };
      finish_export_storage: { Args: { p_id: string; p_path: string }; Returns: undefined };
      finish_notification: {
        Args: { p_error?: string; p_id: string; p_ok: boolean };
        Returns: undefined;
      };
      finish_storage_purge: { Args: { p_ids: number[] }; Returns: undefined };
      force_driver_offline: { Args: { p_driver_id: string; p_reason: string }; Returns: Json };
      get_admin: { Args: { p_admin_id: string }; Returns: Json };
      get_driver: { Args: { p_driver_id: string }; Returns: Json };
      get_driver_trip: { Args: { p_trip_id: string }; Returns: Json };
      get_export_content: { Args: { p_id: string }; Returns: Json };
      get_fare_rule: { Args: { p_rule_id: string }; Returns: Json };
      get_incident: { Args: { p_id: string }; Returns: Json };
      get_ledger_account: {
        Args: { p_cursor?: number; p_id: string; p_limit?: number };
        Returns: Json;
      };
      get_ledger_transaction: { Args: { p_id: string }; Returns: Json };
      get_my_profile: { Args: Record<PropertyKey, never>; Returns: Json };
      get_my_ticket: { Args: { p_id: string }; Returns: Json };
      get_passenger: { Args: { p_profile_id: string }; Returns: Json };
      get_payment: { Args: { p_id: string }; Returns: Json };
      get_payout_batch: { Args: { p_id: string }; Returns: Json };
      get_promotion: { Args: { p_id: string }; Returns: Json };
      get_receipt: { Args: { p_trip_id: string }; Returns: Json };
      get_ride: { Args: { p_request_id: string }; Returns: Json };
      get_ride_pin: { Args: { p_request_id: string }; Returns: Json };
      get_ride_request: { Args: { p_request_id: string }; Returns: Json };
      get_ticket: { Args: { p_id: string }; Returns: Json };
      get_trip: { Args: { p_trip_id: string }; Returns: Json };
      get_trip_finance: { Args: { p_trip_id: string }; Returns: Json };
      get_vehicle: { Args: { p_vehicle_id: string }; Returns: Json };
      hide_rating: { Args: { p_id: string; p_reason: string }; Returns: undefined };
      idempotency_abandon: { Args: { p_key: string; p_route: string }; Returns: undefined };
      idempotency_begin: {
        Args: { p_key: string; p_request_sha256: string; p_route: string };
        Returns: Json;
      };
      idempotency_complete: {
        Args: { p_key: string; p_response: Json; p_route: string; p_status: number };
        Returns: undefined;
      };
      insight_filters: { Args: Record<PropertyKey, never>; Returns: Json };
      intraday_supply: { Args: Record<PropertyKey, never>; Returns: Json };
      invite_admin: {
        Args: { p_email: string; p_full_name: string; p_reason: string; p_template_ids: string[] };
        Returns: string;
      };
      ledger_overview: { Args: Record<PropertyKey, never>; Returns: Json };
      list_active_categories: { Args: { p_lat?: number; p_lng?: number }; Returns: Json };
      list_admin_audit_logs: {
        Args: {
          p_action?: string;
          p_admin_id?: string;
          p_cursor?: number;
          p_entity_id?: string;
          p_entity_type?: string;
          p_from?: string;
          p_limit?: number;
          p_to?: string;
        };
        Returns: Json;
      };
      list_admin_invitations: { Args: Record<PropertyKey, never>; Returns: Json };
      list_admins: { Args: { p_search?: string; p_status?: string }; Returns: Json };
      list_alerts: { Args: { p_status?: string }; Returns: Json };
      list_archive_runs: { Args: Record<PropertyKey, never>; Returns: Json };
      list_change_log: {
        Args: { p_cursor?: number; p_limit?: number; p_record_id?: string; p_table?: string };
        Returns: Json;
      };
      list_deletion_requests: { Args: { p_status?: string }; Returns: Json };
      list_document_queue: {
        Args: { p_cursor?: string; p_limit?: number; p_queue: string; p_sort?: string };
        Returns: Json;
      };
      list_driver_dues: { Args: Record<PropertyKey, never>; Returns: Json };
      list_drivers: {
        Args: {
          p_cursor?: string;
          p_limit?: number;
          p_search?: string;
          p_sort?: string;
          p_tab?: string;
        };
        Returns: Json;
      };
      list_evidence: { Args: { p_incident_id: string }; Returns: Json };
      list_exports: { Args: Record<PropertyKey, never>; Returns: Json };
      list_fare_rules: { Args: Record<PropertyKey, never>; Returns: Json };
      list_flags: { Args: Record<PropertyKey, never>; Returns: Json };
      list_incidents: {
        Args: { p_cursor?: string; p_limit?: number; p_sort?: string; p_status?: string };
        Returns: Json;
      };
      list_ledger_accounts: {
        Args: { p_limit?: number; p_owner_type?: string; p_search?: string };
        Returns: Json;
      };
      list_ledger_transactions: {
        Args: {
          p_cursor?: string;
          p_kind?: string;
          p_limit?: number;
          p_sort?: string;
          p_trip_id?: string;
        };
        Returns: Json;
      };
      list_my_notifications: { Args: { p_limit?: number }; Returns: Json };
      list_my_rides: { Args: { p_cursor?: string; p_limit?: number }; Returns: Json };
      list_my_tickets: { Args: Record<PropertyKey, never>; Returns: Json };
      list_passengers: {
        Args: {
          p_cursor?: string;
          p_limit?: number;
          p_search?: string;
          p_sort?: string;
          p_status?: string;
        };
        Returns: Json;
      };
      list_payments: {
        Args: {
          p_cursor?: string;
          p_limit?: number;
          p_method?: string;
          p_search?: string;
          p_sort?: string;
          p_status?: string;
          p_unreconciled?: boolean;
        };
        Returns: Json;
      };
      list_payout_accounts: { Args: { p_status?: string }; Returns: Json };
      list_payout_batches: { Args: Record<PropertyKey, never>; Returns: Json };
      list_permission_catalogue: { Args: Record<PropertyKey, never>; Returns: Json };
      list_promotions: { Args: { p_status?: string }; Returns: Json };
      list_ratings: {
        Args: {
          p_cursor?: string;
          p_hidden?: boolean;
          p_limit?: number;
          p_max_score?: number;
          p_sort?: string;
        };
        Returns: Json;
      };
      list_refunds: {
        Args: { p_cursor?: string; p_limit?: number; p_status?: string };
        Returns: Json;
      };
      list_ride_requests: {
        Args: {
          p_cursor?: string;
          p_limit?: number;
          p_search?: string;
          p_sort?: string;
          p_status?: string;
        };
        Returns: Json;
      };
      list_saved_views: { Args: { p_page: string }; Returns: Json };
      list_settings: { Args: Record<PropertyKey, never>; Returns: Json };
      list_tickets: {
        Args: {
          p_assignee?: string;
          p_cursor?: string;
          p_limit?: number;
          p_priority?: string;
          p_search?: string;
          p_sort?: string;
          p_status?: string;
        };
        Returns: Json;
      };
      list_trips: {
        Args: {
          p_cursor?: string;
          p_flagged?: boolean;
          p_limit?: number;
          p_search?: string;
          p_sort?: string;
          p_status?: string;
        };
        Returns: Json;
      };
      list_vehicle_categories: { Args: Record<PropertyKey, never>; Returns: Json };
      list_vehicles: {
        Args: {
          p_cursor?: string;
          p_limit?: number;
          p_search?: string;
          p_sort?: string;
          p_status?: string;
        };
        Returns: Json;
      };
      list_zones: { Args: Record<PropertyKey, never>; Returns: Json };
      mark_notifications_read: { Args: { p_ids?: string[] }; Returns: number };
      mark_payout_paid: { Args: { p_payout_id: string; p_reference: string }; Returns: Json };
      my_admin_context: { Args: Record<PropertyKey, never>; Returns: Json };
      onboard_driver: { Args: { p_full_name: string }; Returns: Json };
      onboard_passenger: { Args: { p_full_name: string }; Returns: Json };
      open_driver_document: { Args: { p_document_id: string }; Returns: Json };
      open_evidence: { Args: { p_evidence_id: string }; Returns: Json };
      ops_live_snapshot: { Args: Record<PropertyKey, never>; Returns: Json };
      outbox_overview: { Args: Record<PropertyKey, never>; Returns: Json };
      passenger_wallet: { Args: Record<PropertyKey, never>; Returns: Json };
      payments_overview: { Args: Record<PropertyKey, never>; Returns: Json };
      publish_fare_rule: {
        Args: { p_effective_from: string; p_reason: string; p_rule_id: string };
        Returns: Json;
      };
      rate_trip: {
        Args: { p_comment?: string; p_score: number; p_trip_id: string };
        Returns: Json;
      };
      reactivate_admin: { Args: { p_admin_id: string; p_reason: string }; Returns: undefined };
      reactivate_driver: { Args: { p_driver_id: string; p_reason: string }; Returns: Json };
      read_archive_chunk: {
        Args: { p_after?: number; p_limit?: number; p_run_id: number };
        Returns: Json;
      };
      reconcile_payments: { Args: { p_note?: string; p_payment_ids: string[] }; Returns: Json };
      record_admin_auth_event: { Args: { p_event: string }; Returns: undefined };
      record_cash_deposit: {
        Args: {
          p_amount: number;
          p_driver_id: string;
          p_method: string;
          p_notes?: string;
          p_reference: string;
        };
        Returns: Json;
      };
      redispatch_request: { Args: { p_reason: string; p_request_id: string }; Returns: Json };
      register_device: { Args: { p_platform: string; p_token: string }; Returns: undefined };
      reject_driver: { Args: { p_driver_id: string; p_reason: string }; Returns: Json };
      reject_offer: { Args: { p_offer_id: string; p_reason: string }; Returns: Json };
      renew_ride_pin: { Args: { p_request_id: string }; Returns: Json };
      reorder_vehicle_categories: { Args: { p_ids: string[] }; Returns: undefined };
      reply_my_ticket: { Args: { p_body: string; p_id: string }; Returns: Json };
      reply_ticket: { Args: { p_body: string; p_id: string; p_internal?: boolean }; Returns: Json };
      request_account_deletion: { Args: { p_reason?: string }; Returns: Json };
      request_adjustment: {
        Args: {
          p_account_id: string;
          p_amount: number;
          p_direction: string;
          p_evidence?: string;
          p_reason: string;
        };
        Returns: Json;
      };
      request_export: { Args: { p_from: string; p_kind: string; p_to: string }; Returns: Json };
      request_refund: {
        Args: { p_amount: number; p_evidence?: string; p_payment_id: string; p_reason: string };
        Returns: Json;
      };
      request_reversal: { Args: { p_reason: string; p_transaction_id: string }; Returns: Json };
      resolve_alert: { Args: { p_id: string; p_note: string }; Returns: undefined };
      resolve_trip_failed: { Args: { p_reason: string; p_trip_id: string }; Returns: Json };
      restore_account: { Args: { p_reason: string; p_request_id: string }; Returns: undefined };
      retire_fare_rule: { Args: { p_reason: string; p_rule_id: string }; Returns: Json };
      reveal_pii: {
        Args: { p_field: string; p_profile_id: string; p_reason: string };
        Returns: string;
      };
      review_driver_document: {
        Args: {
          p_decision: string;
          p_document_id: string;
          p_expected_version: number;
          p_reason: string;
        };
        Returns: Json;
      };
      review_payout_account: {
        Args: { p_approve: boolean; p_id: string; p_note?: string };
        Returns: undefined;
      };
      review_refund: {
        Args: { p_approve: boolean; p_id: string; p_reason?: string };
        Returns: Json;
      };
      revoke_permission_template: {
        Args: { p_admin_id: string; p_reason: string; p_template_id: string };
        Returns: undefined;
      };
      run_ledger_verification: { Args: Record<PropertyKey, never>; Returns: Json };
      save_fare_draft: {
        Args: {
          p_category_id: string;
          p_change_note: string;
          p_expected_version: number;
          p_id: string;
          p_values: Json;
          p_zone_id: string;
        };
        Returns: string;
      };
      save_promotion: {
        Args: { p_expected_version?: number; p_id: string; p_payload: Json };
        Returns: Json;
      };
      save_vehicle_category: {
        Args: {
          p_active: boolean;
          p_code: string;
          p_description: string;
          p_expected_version: number;
          p_icon: string;
          p_id: string;
          p_name: string;
          p_name_bn: string;
          p_passenger_capacity: number;
        };
        Returns: string;
      };
      save_view: {
        Args: { p_name: string; p_page: string; p_query: string; p_shared?: boolean };
        Returns: Json;
      };
      save_zone: {
        Args: {
          p_active: boolean;
          p_code: string;
          p_expected_version: number;
          p_geojson: Json;
          p_id: string;
          p_name: string;
          p_reason: string;
        };
        Returns: Json;
      };
      search_options: {
        Args: { p_kind: string; p_limit?: number; p_query?: string };
        Returns: Json;
      };
      seed_demo_users: { Args: Record<PropertyKey, never>; Returns: Json };
      set_current_vehicle: {
        Args: { p_driver_id: string; p_reason: string; p_vehicle_id: string };
        Returns: Json;
      };
      set_flag: {
        Args: {
          p_enabled: boolean;
          p_expected_version: number;
          p_key: string;
          p_reason: string;
          p_rules: Json;
        };
        Returns: Json;
      };
      set_passenger_status: {
        Args: { p_profile_id: string; p_reason: string; p_status: string };
        Returns: Json;
      };
      set_permission_override: {
        Args: { p_admin_id: string; p_effect: string; p_permission: string; p_reason: string };
        Returns: undefined;
      };
      set_promotion_status: {
        Args: { p_id: string; p_reason: string; p_status: string };
        Returns: Json;
      };
      set_template_permissions: {
        Args: { p_permissions: string[]; p_reason: string; p_template_id: string };
        Returns: number;
      };
      set_ticket_priority: { Args: { p_id: string; p_priority: string }; Returns: Json };
      set_ticket_status: {
        Args: { p_id: string; p_note?: string; p_status: string };
        Returns: Json;
      };
      setting_history: { Args: { p_key: string }; Returns: Json };
      simulate_fare: {
        Args: {
          p_compare_rule_id: string;
          p_distance_m: number;
          p_duration_s: number;
          p_surge: number;
          p_values: Json;
          p_waiting_s: number;
        };
        Returns: Json;
      };
      start_evidence_upload: {
        Args: { p_content_type: string; p_incident_id: string };
        Returns: Json;
      };
      surge_overview: { Args: Record<PropertyKey, never>; Returns: Json };
      suspend_admin: { Args: { p_admin_id: string; p_reason: string }; Returns: undefined };
      suspend_driver: { Args: { p_driver_id: string; p_reason: string }; Returns: Json };
      suspend_vehicle: { Args: { p_reason: string; p_vehicle_id: string }; Returns: Json };
      template_impact: { Args: { p_template_id: string }; Returns: number };
      trigger_sos: { Args: { p_note?: string; p_trip_id: string }; Returns: Json };
      unregister_device: { Args: { p_token: string }; Returns: undefined };
      update_driver: {
        Args: { p_driver_id: string; p_expected_version: number; p_home_zone_id: string };
        Returns: Json;
      };
      update_own_profile: {
        Args: { p_expected_version: number; p_full_name: string; p_preferred_language: string };
        Returns: Json;
      };
      update_passenger: {
        Args: {
          p_expected_version: number;
          p_full_name: string;
          p_preferred_language: string;
          p_profile_id: string;
        };
        Returns: Json;
      };
      update_refund_request: {
        Args: { p_amount: number; p_id: string; p_reason: string };
        Returns: Json;
      };
      update_setting: {
        Args: { p_expected_version: number; p_key: string; p_reason: string; p_value: Json };
        Returns: Json;
      };
      verify_vehicle: { Args: { p_reason: string; p_vehicle_id: string }; Returns: Json };
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
      account_deletion_requests: {
        Row: {
          anonymise_after: string;
          completed_at: string | null;
          id: string;
          reason: string | null;
          requested_at: string;
          restored_at: string | null;
          restored_by: string | null;
          role: Database["public"]["Enums"]["app_role"];
          status: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          anonymise_after: string;
          completed_at?: string | null;
          id?: string;
          reason?: string | null;
          requested_at?: string;
          restored_at?: string | null;
          restored_by?: string | null;
          role: Database["public"]["Enums"]["app_role"];
          status?: string;
          user_id: string;
        };
        Update: {
          anonymise_after?: string;
          completed_at?: string | null;
          id?: string;
          reason?: string | null;
          requested_at?: string;
          restored_at?: string | null;
          restored_by?: string | null;
          role?: Database["public"]["Enums"]["app_role"];
          status?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "account_deletion_requests_restored_by_fkey";
            columns: ["restored_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "account_deletion_requests_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      account_status_events: {
        Row: {
          actor_id: string | null;
          actor_type: Database["public"]["Enums"]["actor_type"];
          created_at: string;
          id: number;
          new_status: Database["public"]["Enums"]["account_status"];
          old_status: Database["public"]["Enums"]["account_status"] | null;
          profile_id: string;
          reason: string;
        };
        ComputedFields: never;
        Insert: {
          actor_id?: string | null;
          actor_type: Database["public"]["Enums"]["actor_type"];
          created_at?: string;
          id?: never;
          new_status: Database["public"]["Enums"]["account_status"];
          old_status?: Database["public"]["Enums"]["account_status"] | null;
          profile_id: string;
          reason: string;
        };
        Update: {
          actor_id?: string | null;
          actor_type?: Database["public"]["Enums"]["actor_type"];
          created_at?: string;
          id?: never;
          new_status?: Database["public"]["Enums"]["account_status"];
          old_status?: Database["public"]["Enums"]["account_status"] | null;
          profile_id?: string;
          reason?: string;
        };
        Relationships: [
          {
            foreignKeyName: "account_status_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "account_status_events_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      admin_audit_logs: {
        Row: {
          action: string;
          admin_id: string | null;
          after_data: Json | null;
          before_data: Json | null;
          created_at: string;
          entity_id: string | null;
          entity_type: string;
          id: number;
          ip: unknown;
          reason: string | null;
          request_id: string | null;
          user_agent: string | null;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          admin_id?: string | null;
          after_data?: Json | null;
          before_data?: Json | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type: string;
          id?: never;
          ip?: unknown;
          reason?: string | null;
          request_id?: string | null;
          user_agent?: string | null;
        };
        Update: {
          action?: string;
          admin_id?: string | null;
          after_data?: Json | null;
          before_data?: Json | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string;
          id?: never;
          ip?: unknown;
          reason?: string | null;
          request_id?: string | null;
          user_agent?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "admin_audit_logs_admin_id_fkey";
            columns: ["admin_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      admin_invitations: {
        Row: {
          accepted_at: string | null;
          accepted_profile_id: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          created_at: string;
          email: string;
          expires_at: string;
          full_name: string;
          id: string;
          invited_by: string | null;
          reason: string;
          status: string;
          template_ids: string[];
        };
        ComputedFields: never;
        Insert: {
          accepted_at?: string | null;
          accepted_profile_id?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          created_at?: string;
          email: string;
          expires_at?: string;
          full_name: string;
          id?: string;
          invited_by?: string | null;
          reason: string;
          status?: string;
          template_ids?: string[];
        };
        Update: {
          accepted_at?: string | null;
          accepted_profile_id?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          created_at?: string;
          email?: string;
          expires_at?: string;
          full_name?: string;
          id?: string;
          invited_by?: string | null;
          reason?: string;
          status?: string;
          template_ids?: string[];
        };
        Relationships: [
          {
            foreignKeyName: "admin_invitations_accepted_profile_id_fkey";
            columns: ["accepted_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "admin_invitations_cancelled_by_fkey";
            columns: ["cancelled_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "admin_invitations_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      admin_permission_overrides: {
        Row: {
          admin_id: string;
          created_at: string;
          effect: string;
          granted_by: string | null;
          id: string;
          permission_code: string;
          reason: string;
          revoke_reason: string | null;
          revoked_at: string | null;
          revoked_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          admin_id: string;
          created_at?: string;
          effect: string;
          granted_by?: string | null;
          id?: string;
          permission_code: string;
          reason: string;
          revoke_reason?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
        };
        Update: {
          admin_id?: string;
          created_at?: string;
          effect?: string;
          granted_by?: string | null;
          id?: string;
          permission_code?: string;
          reason?: string;
          revoke_reason?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "admin_permission_overrides_admin_id_fkey";
            columns: ["admin_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "admin_permission_overrides_granted_by_fkey";
            columns: ["granted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "admin_permission_overrides_permission_code_fkey";
            columns: ["permission_code"];
            isOneToOne: false;
            referencedRelation: "permissions";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "admin_permission_overrides_revoked_by_fkey";
            columns: ["revoked_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      admin_profiles: {
        Row: {
          created_at: string;
          created_by: string | null;
          department: string | null;
          id: string;
          invited_by: string | null;
          last_login_at: string | null;
          last_login_ip: unknown;
          mfa_enrolled_at: string | null;
          must_change_password: boolean;
          title: string | null;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          department?: string | null;
          id: string;
          invited_by?: string | null;
          last_login_at?: string | null;
          last_login_ip?: unknown;
          mfa_enrolled_at?: string | null;
          must_change_password?: boolean;
          title?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          department?: string | null;
          id?: string;
          invited_by?: string | null;
          last_login_at?: string | null;
          last_login_ip?: unknown;
          mfa_enrolled_at?: string | null;
          must_change_password?: boolean;
          title?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "admin_profiles_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "admin_profiles_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      admin_template_assignments: {
        Row: {
          admin_id: string;
          assigned_by: string | null;
          created_at: string;
          id: string;
          reason: string;
          revoke_reason: string | null;
          revoked_at: string | null;
          revoked_by: string | null;
          template_id: string;
        };
        ComputedFields: never;
        Insert: {
          admin_id: string;
          assigned_by?: string | null;
          created_at?: string;
          id?: string;
          reason: string;
          revoke_reason?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          template_id: string;
        };
        Update: {
          admin_id?: string;
          assigned_by?: string | null;
          created_at?: string;
          id?: string;
          reason?: string;
          revoke_reason?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          template_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "admin_template_assignments_admin_id_fkey";
            columns: ["admin_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "admin_template_assignments_assigned_by_fkey";
            columns: ["assigned_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "admin_template_assignments_revoked_by_fkey";
            columns: ["revoked_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "admin_template_assignments_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "permission_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      app_settings: {
        Row: {
          created_at: string;
          created_by: string | null;
          description: string | null;
          key: string;
          schema: Json | null;
          updated_at: string;
          updated_by: string | null;
          value: NonNullable<Json>;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          key: string;
          schema?: Json | null;
          updated_at?: string;
          updated_by?: string | null;
          value: NonNullable<Json>;
          version?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          key?: string;
          schema?: Json | null;
          updated_at?: string;
          updated_by?: string | null;
          value?: NonNullable<Json>;
          version?: number;
        };
        Relationships: [];
      };
      archive_exports: {
        Row: {
          bytes: number;
          exported_at: string;
          row_count: number;
          run_id: number;
          sha256: string;
          storage_path: string;
        };
        ComputedFields: never;
        Insert: {
          bytes: number;
          exported_at?: string;
          row_count: number;
          run_id: number;
          sha256: string;
          storage_path: string;
        };
        Update: {
          bytes?: number;
          exported_at?: string;
          row_count?: number;
          run_id?: number;
          sha256?: string;
          storage_path?: string;
        };
        Relationships: [
          {
            foreignKeyName: "archive_exports_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: true;
            referencedRelation: "archive_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      archive_runs: {
        Row: {
          checksum: string | null;
          destination: string | null;
          id: number;
          kind: string;
          partition_name: string | null;
          ran_at: string;
          range_from: string | null;
          range_to: string | null;
          row_count: number;
          source: string;
        };
        ComputedFields: never;
        Insert: {
          checksum?: string | null;
          destination?: string | null;
          id?: never;
          kind: string;
          partition_name?: string | null;
          ran_at?: string;
          range_from?: string | null;
          range_to?: string | null;
          row_count?: number;
          source: string;
        };
        Update: {
          checksum?: string | null;
          destination?: string | null;
          id?: never;
          kind?: string;
          partition_name?: string | null;
          ran_at?: string;
          range_from?: string | null;
          range_to?: string | null;
          row_count?: number;
          source?: string;
        };
        Relationships: [];
      };
      cash_deposits: {
        Row: {
          amount: number;
          created_at: string;
          driver_id: string;
          id: string;
          ledger_transaction_id: string | null;
          method: string;
          notes: string | null;
          received_by: string;
          reference: string | null;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          created_at?: string;
          driver_id: string;
          id?: string;
          ledger_transaction_id?: string | null;
          method: string;
          notes?: string | null;
          received_by: string;
          reference?: string | null;
        };
        Update: {
          amount?: number;
          created_at?: string;
          driver_id?: string;
          id?: string;
          ledger_transaction_id?: string | null;
          method?: string;
          notes?: string | null;
          received_by?: string;
          reference?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "cash_deposits_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "driver_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cash_deposits_ledger_transaction_id_fkey";
            columns: ["ledger_transaction_id"];
            isOneToOne: false;
            referencedRelation: "ledger_transactions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cash_deposits_received_by_fkey";
            columns: ["received_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      dispatch_offers: {
        Row: {
          driver_id: string;
          expires_at: string;
          id: string;
          offered_at: string;
          pickup_distance_m: number;
          pickup_eta_s: number;
          rank: number;
          rejection_reason: string | null;
          request_id: string;
          responded_at: string | null;
          response: Database["public"]["Enums"]["offer_response"];
          round: number;
        };
        ComputedFields: never;
        Insert: {
          driver_id: string;
          expires_at: string;
          id?: string;
          offered_at?: string;
          pickup_distance_m: number;
          pickup_eta_s: number;
          rank: number;
          rejection_reason?: string | null;
          request_id: string;
          responded_at?: string | null;
          response?: Database["public"]["Enums"]["offer_response"];
          round: number;
        };
        Update: {
          driver_id?: string;
          expires_at?: string;
          id?: string;
          offered_at?: string;
          pickup_distance_m?: number;
          pickup_eta_s?: number;
          rank?: number;
          rejection_reason?: string | null;
          request_id?: string;
          responded_at?: string | null;
          response?: Database["public"]["Enums"]["offer_response"];
          round?: number;
        };
        Relationships: [
          {
            foreignKeyName: "dispatch_offers_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "driver_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dispatch_offers_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "ride_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      driver_documents: {
        Row: {
          content_type: string;
          created_at: string;
          created_by: string | null;
          document_number_masked: string | null;
          document_type: Database["public"]["Enums"]["document_type"];
          driver_id: string;
          expires_at: string | null;
          file_sha256: string | null;
          id: string;
          issued_at: string | null;
          rejection_reason: string | null;
          review_status: Database["public"]["Enums"]["review_status"];
          reviewed_at: string | null;
          reviewer_id: string | null;
          size_bytes: number | null;
          storage_path: string;
          superseded_at: string | null;
          supersedes_id: string | null;
          updated_at: string;
          updated_by: string | null;
          uploaded_at: string | null;
          vehicle_id: string | null;
          version: number;
          withdrawn_at: string | null;
          withdrawn_by: string | null;
          withdrawn_reason: string | null;
        };
        ComputedFields: never;
        Insert: {
          content_type: string;
          created_at?: string;
          created_by?: string | null;
          document_number_masked?: string | null;
          document_type: Database["public"]["Enums"]["document_type"];
          driver_id: string;
          expires_at?: string | null;
          file_sha256?: string | null;
          id?: string;
          issued_at?: string | null;
          rejection_reason?: string | null;
          review_status?: Database["public"]["Enums"]["review_status"];
          reviewed_at?: string | null;
          reviewer_id?: string | null;
          size_bytes?: number | null;
          storage_path: string;
          superseded_at?: string | null;
          supersedes_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          uploaded_at?: string | null;
          vehicle_id?: string | null;
          version?: number;
          withdrawn_at?: string | null;
          withdrawn_by?: string | null;
          withdrawn_reason?: string | null;
        };
        Update: {
          content_type?: string;
          created_at?: string;
          created_by?: string | null;
          document_number_masked?: string | null;
          document_type?: Database["public"]["Enums"]["document_type"];
          driver_id?: string;
          expires_at?: string | null;
          file_sha256?: string | null;
          id?: string;
          issued_at?: string | null;
          rejection_reason?: string | null;
          review_status?: Database["public"]["Enums"]["review_status"];
          reviewed_at?: string | null;
          reviewer_id?: string | null;
          size_bytes?: number | null;
          storage_path?: string;
          superseded_at?: string | null;
          supersedes_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          uploaded_at?: string | null;
          vehicle_id?: string | null;
          version?: number;
          withdrawn_at?: string | null;
          withdrawn_by?: string | null;
          withdrawn_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "driver_documents_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "driver_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "driver_documents_reviewer_id_fkey";
            columns: ["reviewer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "driver_documents_supersedes_id_fkey";
            columns: ["supersedes_id"];
            isOneToOne: false;
            referencedRelation: "driver_documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "driver_documents_vehicle_id_fkey";
            columns: ["vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "driver_documents_withdrawn_by_fkey";
            columns: ["withdrawn_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      driver_earnings: {
        Row: {
          commission_amount: number;
          discount_amount: number;
          driver_id: string;
          earned_at: string;
          gross_fare: number;
          id: string;
          net_earning: number;
          payout_id: string | null;
          payout_status: Database["public"]["Enums"]["earning_payout_status"];
          trip_id: string;
        };
        ComputedFields: never;
        Insert: {
          commission_amount: number;
          discount_amount?: number;
          driver_id: string;
          earned_at?: string;
          gross_fare: number;
          id?: string;
          net_earning: number;
          payout_id?: string | null;
          payout_status?: Database["public"]["Enums"]["earning_payout_status"];
          trip_id: string;
        };
        Update: {
          commission_amount?: number;
          discount_amount?: number;
          driver_id?: string;
          earned_at?: string;
          gross_fare?: number;
          id?: string;
          net_earning?: number;
          payout_id?: string | null;
          payout_status?: Database["public"]["Enums"]["earning_payout_status"];
          trip_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "driver_earnings_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "driver_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "driver_earnings_trip_id_fkey";
            columns: ["trip_id"];
            isOneToOne: true;
            referencedRelation: "trips";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fk_driver_earnings_payout";
            columns: ["payout_id"];
            isOneToOne: false;
            referencedRelation: "payouts";
            referencedColumns: ["id"];
          },
        ];
      };
      driver_live_locations: {
        Row: {
          accuracy_m: number | null;
          driver_id: string;
          heading: number | null;
          location: unknown;
          recorded_at: string;
          speed_mps: number | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          accuracy_m?: number | null;
          driver_id: string;
          heading?: number | null;
          location: unknown;
          recorded_at: string;
          speed_mps?: number | null;
          updated_at?: string;
        };
        Update: {
          accuracy_m?: number | null;
          driver_id?: string;
          heading?: number | null;
          location?: unknown;
          recorded_at?: string;
          speed_mps?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "driver_live_locations_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: true;
            referencedRelation: "driver_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      driver_payout_accounts: {
        Row: {
          account_holder: string;
          account_ref_enc: string;
          account_ref_masked: string;
          created_at: string;
          driver_id: string;
          id: string;
          is_default: boolean;
          method: string;
          review_note: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          account_holder: string;
          account_ref_enc: string;
          account_ref_masked: string;
          created_at?: string;
          driver_id: string;
          id?: string;
          is_default?: boolean;
          method: string;
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          account_holder?: string;
          account_ref_enc?: string;
          account_ref_masked?: string;
          created_at?: string;
          driver_id?: string;
          id?: string;
          is_default?: boolean;
          method?: string;
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "driver_payout_accounts_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "driver_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "driver_payout_accounts_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      driver_profiles: {
        Row: {
          acceptance_rate_30d: number | null;
          approved_at: string | null;
          approved_by: string | null;
          availability: Database["public"]["Enums"]["driver_availability"];
          cancellation_rate_30d: number | null;
          created_at: string;
          created_by: string | null;
          current_vehicle_id: string | null;
          home_zone_id: string | null;
          id: string;
          licence_expiry: string | null;
          licence_number_enc: string | null;
          licence_number_masked: string | null;
          onboarding_status: Database["public"]["Enums"]["driver_onboarding_status"];
          rating_avg: number | null;
          rating_count: number;
          rejected_reason: string | null;
          submitted_at: string | null;
          suspended_reason: string | null;
          updated_at: string;
          updated_by: string | null;
          user_id: string;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          acceptance_rate_30d?: number | null;
          approved_at?: string | null;
          approved_by?: string | null;
          availability?: Database["public"]["Enums"]["driver_availability"];
          cancellation_rate_30d?: number | null;
          created_at?: string;
          created_by?: string | null;
          current_vehicle_id?: string | null;
          home_zone_id?: string | null;
          id?: string;
          licence_expiry?: string | null;
          licence_number_enc?: string | null;
          licence_number_masked?: string | null;
          onboarding_status?: Database["public"]["Enums"]["driver_onboarding_status"];
          rating_avg?: number | null;
          rating_count?: number;
          rejected_reason?: string | null;
          submitted_at?: string | null;
          suspended_reason?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          user_id: string;
          version?: number;
        };
        Update: {
          acceptance_rate_30d?: number | null;
          approved_at?: string | null;
          approved_by?: string | null;
          availability?: Database["public"]["Enums"]["driver_availability"];
          cancellation_rate_30d?: number | null;
          created_at?: string;
          created_by?: string | null;
          current_vehicle_id?: string | null;
          home_zone_id?: string | null;
          id?: string;
          licence_expiry?: string | null;
          licence_number_enc?: string | null;
          licence_number_masked?: string | null;
          onboarding_status?: Database["public"]["Enums"]["driver_onboarding_status"];
          rating_avg?: number | null;
          rating_count?: number;
          rejected_reason?: string | null;
          submitted_at?: string | null;
          suspended_reason?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          user_id?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "driver_profiles_approved_by_fkey";
            columns: ["approved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "driver_profiles_home_zone_id_fkey";
            columns: ["home_zone_id"];
            isOneToOne: false;
            referencedRelation: "service_zones";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "driver_profiles_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fk_driver_profiles_current_vehicle";
            columns: ["current_vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id"];
          },
        ];
      };
      driver_status_events: {
        Row: {
          actor_id: string | null;
          actor_type: Database["public"]["Enums"]["actor_type"];
          created_at: string;
          driver_id: string;
          id: number;
          kind: string;
          location: unknown;
          new_status: string;
          old_status: string | null;
          reason: string | null;
        };
        ComputedFields: never;
        Insert: {
          actor_id?: string | null;
          actor_type: Database["public"]["Enums"]["actor_type"];
          created_at?: string;
          driver_id: string;
          id?: never;
          kind: string;
          location?: unknown;
          new_status: string;
          old_status?: string | null;
          reason?: string | null;
        };
        Update: {
          actor_id?: string | null;
          actor_type?: Database["public"]["Enums"]["actor_type"];
          created_at?: string;
          driver_id?: string;
          id?: never;
          kind?: string;
          location?: unknown;
          new_status?: string;
          old_status?: string | null;
          reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "driver_status_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "driver_status_events_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "driver_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      export_jobs: {
        Row: {
          byte_size: number | null;
          content: string | null;
          created_at: string;
          error: string | null;
          expires_at: string | null;
          finished_at: string | null;
          id: string;
          kind: string;
          params: NonNullable<Json>;
          requested_by: string;
          row_count: number | null;
          status: string;
          storage_path: string | null;
        };
        ComputedFields: never;
        Insert: {
          byte_size?: number | null;
          content?: string | null;
          created_at?: string;
          error?: string | null;
          expires_at?: string | null;
          finished_at?: string | null;
          id?: string;
          kind: string;
          params?: NonNullable<Json>;
          requested_by: string;
          row_count?: number | null;
          status?: string;
          storage_path?: string | null;
        };
        Update: {
          byte_size?: number | null;
          content?: string | null;
          created_at?: string;
          error?: string | null;
          expires_at?: string | null;
          finished_at?: string | null;
          id?: string;
          kind?: string;
          params?: NonNullable<Json>;
          requested_by?: string;
          row_count?: number | null;
          status?: string;
          storage_path?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "export_jobs_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      fare_quotes: {
        Row: {
          breakdown: NonNullable<Json>;
          category_id: string;
          created_at: string;
          destination_label: string | null;
          destination_point: unknown;
          estimated_distance_m: number;
          estimated_duration_s: number;
          estimated_fare: number;
          expires_at: string;
          fare_rule_id: string;
          id: string;
          passenger_id: string;
          pickup_label: string | null;
          pickup_point: unknown;
          pricing_rule_snapshot: NonNullable<Json>;
          surge_multiplier: number;
          zone_id: string;
        };
        ComputedFields: never;
        Insert: {
          breakdown: NonNullable<Json>;
          category_id: string;
          created_at?: string;
          destination_label?: string | null;
          destination_point: unknown;
          estimated_distance_m: number;
          estimated_duration_s: number;
          estimated_fare: number;
          expires_at: string;
          fare_rule_id: string;
          id?: string;
          passenger_id: string;
          pickup_label?: string | null;
          pickup_point: unknown;
          pricing_rule_snapshot: NonNullable<Json>;
          surge_multiplier: number;
          zone_id: string;
        };
        Update: {
          breakdown?: NonNullable<Json>;
          category_id?: string;
          created_at?: string;
          destination_label?: string | null;
          destination_point?: unknown;
          estimated_distance_m?: number;
          estimated_duration_s?: number;
          estimated_fare?: number;
          expires_at?: string;
          fare_rule_id?: string;
          id?: string;
          passenger_id?: string;
          pickup_label?: string | null;
          pickup_point?: unknown;
          pricing_rule_snapshot?: NonNullable<Json>;
          surge_multiplier?: number;
          zone_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fare_quotes_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "vehicle_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fare_quotes_fare_rule_id_fkey";
            columns: ["fare_rule_id"];
            isOneToOne: false;
            referencedRelation: "fare_rules";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fare_quotes_passenger_id_fkey";
            columns: ["passenger_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fare_quotes_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "service_zones";
            referencedColumns: ["id"];
          },
        ];
      };
      fare_rules: {
        Row: {
          base_fare: number;
          booking_fee: number;
          cancellation_fee: number;
          category_id: string;
          change_note: string | null;
          commissionable_components: string[];
          created_at: string;
          created_by: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          effective_from: string | null;
          effective_to: string | null;
          free_waiting_minutes: number;
          id: string;
          max_surge_multiplier: number;
          minimum_fare: number;
          per_km: number;
          per_minute: number;
          platform_commission_pct: number;
          published_at: string | null;
          published_by: string | null;
          rule_version: number;
          status: Database["public"]["Enums"]["fare_rule_status"];
          updated_at: string;
          updated_by: string | null;
          version: number;
          waiting_per_minute: number;
          zone_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          base_fare: number;
          booking_fee?: number;
          cancellation_fee?: number;
          category_id: string;
          change_note?: string | null;
          commissionable_components?: string[];
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          effective_from?: string | null;
          effective_to?: string | null;
          free_waiting_minutes?: number;
          id?: string;
          max_surge_multiplier?: number;
          minimum_fare: number;
          per_km: number;
          per_minute: number;
          platform_commission_pct: number;
          published_at?: string | null;
          published_by?: string | null;
          rule_version: number;
          status?: Database["public"]["Enums"]["fare_rule_status"];
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
          waiting_per_minute?: number;
          zone_id?: string | null;
        };
        Update: {
          base_fare?: number;
          booking_fee?: number;
          cancellation_fee?: number;
          category_id?: string;
          change_note?: string | null;
          commissionable_components?: string[];
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          effective_from?: string | null;
          effective_to?: string | null;
          free_waiting_minutes?: number;
          id?: string;
          max_surge_multiplier?: number;
          minimum_fare?: number;
          per_km?: number;
          per_minute?: number;
          platform_commission_pct?: number;
          published_at?: string | null;
          published_by?: string | null;
          rule_version?: number;
          status?: Database["public"]["Enums"]["fare_rule_status"];
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
          waiting_per_minute?: number;
          zone_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "fare_rules_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "vehicle_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fare_rules_published_by_fkey";
            columns: ["published_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fare_rules_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "service_zones";
            referencedColumns: ["id"];
          },
        ];
      };
      feature_flags: {
        Row: {
          created_at: string;
          created_by: string | null;
          description: string | null;
          enabled: boolean;
          key: string;
          rules: NonNullable<Json>;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          enabled?: boolean;
          key: string;
          rules?: NonNullable<Json>;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          enabled?: boolean;
          key?: string;
          rules?: NonNullable<Json>;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [];
      };
      idempotency_keys: {
        Row: {
          completed_at: string | null;
          created_at: string;
          key: string;
          locked_until: string | null;
          request_sha256: string;
          response: Json | null;
          scope: string;
          status_code: number | null;
        };
        ComputedFields: never;
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          key: string;
          locked_until?: string | null;
          request_sha256: string;
          response?: Json | null;
          scope: string;
          status_code?: number | null;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          key?: string;
          locked_until?: string | null;
          request_sha256?: string;
          response?: Json | null;
          scope?: string;
          status_code?: number | null;
        };
        Relationships: [];
      };
      kpi_online: {
        Row: {
          bucket_start: string;
          computed_at: string;
          drivers: number;
          grain: string;
          on_trip_s: number;
          online_s: number;
        };
        ComputedFields: never;
        Insert: {
          bucket_start: string;
          computed_at?: string;
          drivers?: number;
          grain: string;
          on_trip_s?: number;
          online_s?: number;
        };
        Update: {
          bucket_start?: string;
          computed_at?: string;
          drivers?: number;
          grain?: string;
          on_trip_s?: number;
          online_s?: number;
        };
        Relationships: [];
      };
      kpi_rollups: {
        Row: {
          active_drivers: number;
          bucket_start: string;
          cancelled_admin: number;
          cancelled_driver: number;
          cancelled_passenger: number;
          category_id: string;
          completed_requests: number;
          completed_trips: number;
          computed_at: string;
          contribution: number;
          discounts: number;
          distance_m: number;
          driver_earnings: number;
          duration_s: number;
          failed_requests: number;
          flagged_fares: number;
          grain: string;
          gross_bookings: number;
          match_p50_s: number | null;
          match_p90_s: number | null;
          matched: number;
          no_driver: number;
          platform_revenue: number;
          requests: number;
          started: number;
          zone_id: string;
        };
        ComputedFields: never;
        Insert: {
          active_drivers?: number;
          bucket_start: string;
          cancelled_admin?: number;
          cancelled_driver?: number;
          cancelled_passenger?: number;
          category_id: string;
          completed_requests?: number;
          completed_trips?: number;
          computed_at?: string;
          contribution?: number;
          discounts?: number;
          distance_m?: number;
          driver_earnings?: number;
          duration_s?: number;
          failed_requests?: number;
          flagged_fares?: number;
          grain: string;
          gross_bookings?: number;
          match_p50_s?: number | null;
          match_p90_s?: number | null;
          matched?: number;
          no_driver?: number;
          platform_revenue?: number;
          requests?: number;
          started?: number;
          zone_id: string;
        };
        Update: {
          active_drivers?: number;
          bucket_start?: string;
          cancelled_admin?: number;
          cancelled_driver?: number;
          cancelled_passenger?: number;
          category_id?: string;
          completed_requests?: number;
          completed_trips?: number;
          computed_at?: string;
          contribution?: number;
          discounts?: number;
          distance_m?: number;
          driver_earnings?: number;
          duration_s?: number;
          failed_requests?: number;
          flagged_fares?: number;
          grain?: string;
          gross_bookings?: number;
          match_p50_s?: number | null;
          match_p90_s?: number | null;
          matched?: number;
          no_driver?: number;
          platform_revenue?: number;
          requests?: number;
          started?: number;
          zone_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "kpi_rollups_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "vehicle_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "kpi_rollups_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "service_zones";
            referencedColumns: ["id"];
          },
        ];
      };
      ledger_account_balances: {
        Row: {
          account_id: string;
          balance: number;
          credit_total: number;
          debit_total: number;
          last_entry_id: number | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          account_id: string;
          balance?: number;
          credit_total?: number;
          debit_total?: number;
          last_entry_id?: number | null;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          balance?: number;
          credit_total?: number;
          debit_total?: number;
          last_entry_id?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ledger_account_balances_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: true;
            referencedRelation: "ledger_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      ledger_accounts: {
        Row: {
          code: string;
          created_at: string;
          currency: string;
          id: string;
          kind: string;
          owner_id: string | null;
          owner_type: string;
        };
        ComputedFields: never;
        Insert: {
          code: string;
          created_at?: string;
          currency?: string;
          id?: string;
          kind: string;
          owner_id?: string | null;
          owner_type: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          currency?: string;
          id?: string;
          kind?: string;
          owner_id?: string | null;
          owner_type?: string;
        };
        Relationships: [];
      };
      ledger_entries: {
        Row: {
          account_id: string;
          created_at: string;
          credit: number;
          debit: number;
          id: number;
          transaction_id: string;
        };
        ComputedFields: never;
        Insert: {
          account_id: string;
          created_at?: string;
          credit?: number;
          debit?: number;
          id?: never;
          transaction_id: string;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          credit?: number;
          debit?: number;
          id?: never;
          transaction_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ledger_entries_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "ledger_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ledger_entries_transaction_id_fkey";
            columns: ["transaction_id"];
            isOneToOne: false;
            referencedRelation: "ledger_transactions";
            referencedColumns: ["id"];
          },
        ];
      };
      ledger_transactions: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          kind: string;
          memo: string | null;
          reference: string;
          reverses_id: string | null;
          trip_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          kind: string;
          memo?: string | null;
          reference: string;
          reverses_id?: string | null;
          trip_id?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          kind?: string;
          memo?: string | null;
          reference?: string;
          reverses_id?: string | null;
          trip_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ledger_transactions_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ledger_transactions_reverses_id_fkey";
            columns: ["reverses_id"];
            isOneToOne: true;
            referencedRelation: "ledger_transactions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ledger_transactions_trip_id_fkey";
            columns: ["trip_id"];
            isOneToOne: false;
            referencedRelation: "trips";
            referencedColumns: ["id"];
          },
        ];
      };
      ledger_verification_runs: {
        Row: {
          accounts_checked: number;
          details: NonNullable<Json>;
          drift_count: number;
          id: number;
          ok: boolean | null;
          ran_at: string;
          unbalanced_count: number;
        };
        ComputedFields: never;
        Insert: {
          accounts_checked: number;
          details?: NonNullable<Json>;
          drift_count: number;
          id?: never;
          ok?: never;
          ran_at?: string;
          unbalanced_count: number;
        };
        Update: {
          accounts_checked?: number;
          details?: NonNullable<Json>;
          drift_count?: number;
          id?: never;
          ok?: never;
          ran_at?: string;
          unbalanced_count?: number;
        };
        Relationships: [];
      };
      notification_outbox: {
        Row: {
          attempts: number;
          body: string;
          channel: string;
          created_at: string;
          dedupe_key: string | null;
          id: string;
          last_error: string | null;
          link: string | null;
          next_attempt_at: string;
          recipient_id: string;
          sent_at: string | null;
          status: string;
          subject: string;
          to_address: string | null;
        };
        ComputedFields: never;
        Insert: {
          attempts?: number;
          body: string;
          channel: string;
          created_at?: string;
          dedupe_key?: string | null;
          id?: string;
          last_error?: string | null;
          link?: string | null;
          next_attempt_at?: string;
          recipient_id: string;
          sent_at?: string | null;
          status?: string;
          subject: string;
          to_address?: string | null;
        };
        Update: {
          attempts?: number;
          body?: string;
          channel?: string;
          created_at?: string;
          dedupe_key?: string | null;
          id?: string;
          last_error?: string | null;
          link?: string | null;
          next_attempt_at?: string;
          recipient_id?: string;
          sent_at?: string | null;
          status?: string;
          subject?: string;
          to_address?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "notification_outbox_recipient_id_fkey";
            columns: ["recipient_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          body: string | null;
          created_at: string;
          id: string;
          kind: string;
          link: string | null;
          read_at: string | null;
          recipient_id: string;
          title: string;
        };
        ComputedFields: never;
        Insert: {
          body?: string | null;
          created_at?: string;
          id?: string;
          kind: string;
          link?: string | null;
          read_at?: string | null;
          recipient_id: string;
          title: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          id?: string;
          kind?: string;
          link?: string | null;
          read_at?: string | null;
          recipient_id?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_id_fkey";
            columns: ["recipient_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      ops_alerts: {
        Row: {
          ack_note: string | null;
          acknowledged_at: string | null;
          acknowledged_by: string | null;
          alert_key: string;
          audience: string;
          detail: NonNullable<Json>;
          first_seen_at: string;
          id: string;
          last_seen_at: string;
          resolved_at: string | null;
          severity: string;
          status: string;
          title: string;
        };
        ComputedFields: never;
        Insert: {
          ack_note?: string | null;
          acknowledged_at?: string | null;
          acknowledged_by?: string | null;
          alert_key: string;
          audience?: string;
          detail?: NonNullable<Json>;
          first_seen_at?: string;
          id?: string;
          last_seen_at?: string;
          resolved_at?: string | null;
          severity: string;
          status?: string;
          title: string;
        };
        Update: {
          ack_note?: string | null;
          acknowledged_at?: string | null;
          acknowledged_by?: string | null;
          alert_key?: string;
          audience?: string;
          detail?: NonNullable<Json>;
          first_seen_at?: string;
          id?: string;
          last_seen_at?: string;
          resolved_at?: string | null;
          severity?: string;
          status?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ops_alerts_acknowledged_by_fkey";
            columns: ["acknowledged_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_events: {
        Row: {
          created_at: string;
          from_status: Database["public"]["Enums"]["payment_status"] | null;
          id: number;
          note: string | null;
          payment_id: string;
          source: string;
          to_status: Database["public"]["Enums"]["payment_status"];
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          from_status?: Database["public"]["Enums"]["payment_status"] | null;
          id?: never;
          note?: string | null;
          payment_id: string;
          source: string;
          to_status: Database["public"]["Enums"]["payment_status"];
        };
        Update: {
          created_at?: string;
          from_status?: Database["public"]["Enums"]["payment_status"] | null;
          id?: never;
          note?: string | null;
          payment_id?: string;
          source?: string;
          to_status?: Database["public"]["Enums"]["payment_status"];
        };
        Relationships: [
          {
            foreignKeyName: "payment_events_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_reconciliations: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          note: string | null;
          payment_count: number;
          total_amount: number;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by: string;
          id?: string;
          note?: string | null;
          payment_count: number;
          total_amount: number;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          note?: string | null;
          payment_count?: number;
          total_amount?: number;
        };
        Relationships: [
          {
            foreignKeyName: "payment_reconciliations_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          amount: number;
          collected_amount: number | null;
          collected_at: string | null;
          collected_by_driver_id: string | null;
          created_at: string;
          currency: string;
          driver_id: string;
          fee_collected: number;
          id: string;
          method: Database["public"]["Enums"]["payment_method"];
          passenger_id: string;
          provider: string | null;
          provider_reference: string | null;
          reconciled_at: string | null;
          reconciled_by: string | null;
          reconciliation_id: string | null;
          refunded_amount: number;
          status: Database["public"]["Enums"]["payment_status"];
          trip_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          collected_amount?: number | null;
          collected_at?: string | null;
          collected_by_driver_id?: string | null;
          created_at?: string;
          currency?: string;
          driver_id: string;
          fee_collected?: number;
          id?: string;
          method: Database["public"]["Enums"]["payment_method"];
          passenger_id: string;
          provider?: string | null;
          provider_reference?: string | null;
          reconciled_at?: string | null;
          reconciled_by?: string | null;
          reconciliation_id?: string | null;
          refunded_amount?: number;
          status?: Database["public"]["Enums"]["payment_status"];
          trip_id: string;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          collected_amount?: number | null;
          collected_at?: string | null;
          collected_by_driver_id?: string | null;
          created_at?: string;
          currency?: string;
          driver_id?: string;
          fee_collected?: number;
          id?: string;
          method?: Database["public"]["Enums"]["payment_method"];
          passenger_id?: string;
          provider?: string | null;
          provider_reference?: string | null;
          reconciled_at?: string | null;
          reconciled_by?: string | null;
          reconciliation_id?: string | null;
          refunded_amount?: number;
          status?: Database["public"]["Enums"]["payment_status"];
          trip_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fk_payments_reconciliation";
            columns: ["reconciliation_id"];
            isOneToOne: false;
            referencedRelation: "payment_reconciliations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_collected_by_driver_id_fkey";
            columns: ["collected_by_driver_id"];
            isOneToOne: false;
            referencedRelation: "driver_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "driver_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_passenger_id_fkey";
            columns: ["passenger_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_reconciled_by_fkey";
            columns: ["reconciled_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_trip_id_fkey";
            columns: ["trip_id"];
            isOneToOne: true;
            referencedRelation: "trips";
            referencedColumns: ["id"];
          },
        ];
      };
      payout_batches: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          created_at: string;
          created_by: string;
          id: string;
          notes: string | null;
          payout_count: number;
          period_end: string;
          period_start: string;
          status: string;
          total_amount: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          created_by: string;
          id?: string;
          notes?: string | null;
          payout_count?: number;
          period_end: string;
          period_start: string;
          status?: string;
          total_amount?: number;
          updated_at?: string;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          created_by?: string;
          id?: string;
          notes?: string | null;
          payout_count?: number;
          period_end?: string;
          period_start?: string;
          status?: string;
          total_amount?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payout_batches_approved_by_fkey";
            columns: ["approved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payout_batches_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      payouts: {
        Row: {
          amount: number;
          approve_transaction_id: string | null;
          approved_at: string | null;
          approved_by: string | null;
          batch_id: string;
          created_at: string;
          currency: string;
          driver_id: string;
          failure_reason: string | null;
          id: string;
          paid_at: string | null;
          paid_by: string | null;
          paid_transaction_id: string | null;
          payout_account_id: string;
          reference: string | null;
          status: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          approve_transaction_id?: string | null;
          approved_at?: string | null;
          approved_by?: string | null;
          batch_id: string;
          created_at?: string;
          currency?: string;
          driver_id: string;
          failure_reason?: string | null;
          id?: string;
          paid_at?: string | null;
          paid_by?: string | null;
          paid_transaction_id?: string | null;
          payout_account_id: string;
          reference?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          approve_transaction_id?: string | null;
          approved_at?: string | null;
          approved_by?: string | null;
          batch_id?: string;
          created_at?: string;
          currency?: string;
          driver_id?: string;
          failure_reason?: string | null;
          id?: string;
          paid_at?: string | null;
          paid_by?: string | null;
          paid_transaction_id?: string | null;
          payout_account_id?: string;
          reference?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payouts_approve_transaction_id_fkey";
            columns: ["approve_transaction_id"];
            isOneToOne: false;
            referencedRelation: "ledger_transactions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payouts_approved_by_fkey";
            columns: ["approved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payouts_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "payout_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payouts_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "driver_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payouts_paid_by_fkey";
            columns: ["paid_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payouts_paid_transaction_id_fkey";
            columns: ["paid_transaction_id"];
            isOneToOne: false;
            referencedRelation: "ledger_transactions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payouts_payout_account_id_fkey";
            columns: ["payout_account_id"];
            isOneToOne: false;
            referencedRelation: "driver_payout_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      permission_template_items: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          permission_code: string;
          removed_at: string | null;
          removed_by: string | null;
          template_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          permission_code: string;
          removed_at?: string | null;
          removed_by?: string | null;
          template_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          permission_code?: string;
          removed_at?: string | null;
          removed_by?: string | null;
          template_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "permission_template_items_permission_code_fkey";
            columns: ["permission_code"];
            isOneToOne: false;
            referencedRelation: "permissions";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "permission_template_items_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "permission_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      permission_templates: {
        Row: {
          code: string;
          created_at: string;
          created_by: string | null;
          delete_reason: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          description: string | null;
          id: string;
          is_builtin: boolean;
          name: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          code: string;
          created_at?: string;
          created_by?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          description?: string | null;
          id?: string;
          is_builtin?: boolean;
          name: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          code?: string;
          created_at?: string;
          created_by?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          description?: string | null;
          id?: string;
          is_builtin?: boolean;
          name?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [];
      };
      permissions: {
        Row: {
          code: string;
          created_at: string;
          description: string;
          is_high_impact: boolean;
          module: string;
          sort_order: number;
        };
        ComputedFields: never;
        Insert: {
          code: string;
          created_at?: string;
          description: string;
          is_high_impact?: boolean;
          module: string;
          sort_order?: number;
        };
        Update: {
          code?: string;
          created_at?: string;
          description?: string;
          is_high_impact?: boolean;
          module?: string;
          sort_order?: number;
        };
        Relationships: [];
      };
      pii_access_logs: {
        Row: {
          admin_id: string;
          created_at: string;
          field: string;
          id: number;
          reason: string | null;
          subject_profile_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          admin_id: string;
          created_at?: string;
          field: string;
          id?: never;
          reason?: string | null;
          subject_profile_id?: string | null;
        };
        Update: {
          admin_id?: string;
          created_at?: string;
          field?: string;
          id?: never;
          reason?: string | null;
          subject_profile_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "pii_access_logs_admin_id_fkey";
            columns: ["admin_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pii_access_logs_subject_profile_id_fkey";
            columns: ["subject_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_path: string | null;
          created_at: string;
          created_by: string | null;
          delete_reason: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          email: string | null;
          full_name: string;
          id: string;
          last_seen_at: string | null;
          phone: string | null;
          preferred_language: string;
          role: Database["public"]["Enums"]["app_role"];
          status: Database["public"]["Enums"]["account_status"];
          suspended_reason: string | null;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          avatar_path?: string | null;
          created_at?: string;
          created_by?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          email?: string | null;
          full_name: string;
          id: string;
          last_seen_at?: string | null;
          phone?: string | null;
          preferred_language?: string;
          role: Database["public"]["Enums"]["app_role"];
          status?: Database["public"]["Enums"]["account_status"];
          suspended_reason?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          avatar_path?: string | null;
          created_at?: string;
          created_by?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          email?: string | null;
          full_name?: string;
          id?: string;
          last_seen_at?: string | null;
          phone?: string | null;
          preferred_language?: string;
          role?: Database["public"]["Enums"]["app_role"];
          status?: Database["public"]["Enums"]["account_status"];
          suspended_reason?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [];
      };
      promotion_redemptions: {
        Row: {
          applied_amount: number | null;
          created_at: string;
          id: string;
          passenger_id: string;
          promotion_id: string;
          request_id: string;
          reserved_amount: number;
          status: string;
          trip_id: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          applied_amount?: number | null;
          created_at?: string;
          id?: string;
          passenger_id: string;
          promotion_id: string;
          request_id: string;
          reserved_amount: number;
          status?: string;
          trip_id?: string | null;
          updated_at?: string;
        };
        Update: {
          applied_amount?: number | null;
          created_at?: string;
          id?: string;
          passenger_id?: string;
          promotion_id?: string;
          request_id?: string;
          reserved_amount?: number;
          status?: string;
          trip_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "promotion_redemptions_passenger_id_fkey";
            columns: ["passenger_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "promotion_redemptions_promotion_id_fkey";
            columns: ["promotion_id"];
            isOneToOne: false;
            referencedRelation: "promotions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "promotion_redemptions_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: true;
            referencedRelation: "ride_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "promotion_redemptions_trip_id_fkey";
            columns: ["trip_id"];
            isOneToOne: false;
            referencedRelation: "trips";
            referencedColumns: ["id"];
          },
        ];
      };
      promotions: {
        Row: {
          budget_limit: number | null;
          budget_spent: number;
          category_ids: string[];
          code: string;
          created_at: string;
          created_by: string | null;
          description: string | null;
          discount_type: string;
          discount_value: number;
          ends_at: string;
          id: string;
          max_discount: number | null;
          min_fare: number;
          name: string;
          new_users_only: boolean;
          per_user_limit: number;
          starts_at: string;
          status: string;
          total_redemption_limit: number | null;
          updated_at: string;
          version: number;
          zone_ids: string[];
        };
        ComputedFields: never;
        Insert: {
          budget_limit?: number | null;
          budget_spent?: number;
          category_ids?: string[];
          code: string;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          discount_type: string;
          discount_value: number;
          ends_at: string;
          id?: string;
          max_discount?: number | null;
          min_fare?: number;
          name: string;
          new_users_only?: boolean;
          per_user_limit?: number;
          starts_at: string;
          status?: string;
          total_redemption_limit?: number | null;
          updated_at?: string;
          version?: number;
          zone_ids?: string[];
        };
        Update: {
          budget_limit?: number | null;
          budget_spent?: number;
          category_ids?: string[];
          code?: string;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          discount_type?: string;
          discount_value?: number;
          ends_at?: string;
          id?: string;
          max_discount?: number | null;
          min_fare?: number;
          name?: string;
          new_users_only?: boolean;
          per_user_limit?: number;
          starts_at?: string;
          status?: string;
          total_redemption_limit?: number | null;
          updated_at?: string;
          version?: number;
          zone_ids?: string[];
        };
        Relationships: [
          {
            foreignKeyName: "promotions_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      push_devices: {
        Row: {
          created_at: string;
          id: string;
          last_seen_at: string;
          platform: string;
          token: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          last_seen_at?: string;
          platform: string;
          token: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          last_seen_at?: string;
          platform?: string;
          token?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "push_devices_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      rate_limits: {
        Row: {
          bucket: string;
          hits: number;
          window_start: string;
        };
        ComputedFields: never;
        Insert: {
          bucket: string;
          hits: number;
          window_start: string;
        };
        Update: {
          bucket?: string;
          hits?: number;
          window_start?: string;
        };
        Relationships: [];
      };
      ratings: {
        Row: {
          comment: string | null;
          created_at: string;
          hidden_at: string | null;
          hidden_by: string | null;
          hidden_reason: string | null;
          id: string;
          reviewee_id: string;
          reviewer_id: string;
          reviewer_role: Database["public"]["Enums"]["app_role"];
          score: number;
          trip_id: string;
        };
        ComputedFields: never;
        Insert: {
          comment?: string | null;
          created_at?: string;
          hidden_at?: string | null;
          hidden_by?: string | null;
          hidden_reason?: string | null;
          id?: string;
          reviewee_id: string;
          reviewer_id: string;
          reviewer_role: Database["public"]["Enums"]["app_role"];
          score: number;
          trip_id: string;
        };
        Update: {
          comment?: string | null;
          created_at?: string;
          hidden_at?: string | null;
          hidden_by?: string | null;
          hidden_reason?: string | null;
          id?: string;
          reviewee_id?: string;
          reviewer_id?: string;
          reviewer_role?: Database["public"]["Enums"]["app_role"];
          score?: number;
          trip_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ratings_hidden_by_fkey";
            columns: ["hidden_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ratings_reviewee_id_fkey";
            columns: ["reviewee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ratings_reviewer_id_fkey";
            columns: ["reviewer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ratings_trip_id_fkey";
            columns: ["trip_id"];
            isOneToOne: false;
            referencedRelation: "trips";
            referencedColumns: ["id"];
          },
        ];
      };
      refunds_adjustments: {
        Row: {
          account_id: string | null;
          amount: number;
          approved_at: string | null;
          approved_by: string | null;
          created_at: string;
          currency: string;
          direction: string | null;
          evidence: string | null;
          id: string;
          kind: string;
          ledger_transaction_id: string | null;
          passenger_id: string | null;
          payment_id: string | null;
          reason: string;
          rejected_by: string | null;
          rejection_reason: string | null;
          requested_by: string;
          reverses_transaction_id: string | null;
          second_approved_by: string | null;
          status: string;
          trip_id: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          account_id?: string | null;
          amount: number;
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          currency?: string;
          direction?: string | null;
          evidence?: string | null;
          id?: string;
          kind: string;
          ledger_transaction_id?: string | null;
          passenger_id?: string | null;
          payment_id?: string | null;
          reason: string;
          rejected_by?: string | null;
          rejection_reason?: string | null;
          requested_by: string;
          reverses_transaction_id?: string | null;
          second_approved_by?: string | null;
          status?: string;
          trip_id?: string | null;
          updated_at?: string;
        };
        Update: {
          account_id?: string | null;
          amount?: number;
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          currency?: string;
          direction?: string | null;
          evidence?: string | null;
          id?: string;
          kind?: string;
          ledger_transaction_id?: string | null;
          passenger_id?: string | null;
          payment_id?: string | null;
          reason?: string;
          rejected_by?: string | null;
          rejection_reason?: string | null;
          requested_by?: string;
          reverses_transaction_id?: string | null;
          second_approved_by?: string | null;
          status?: string;
          trip_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "refunds_adjustments_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "ledger_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "refunds_adjustments_approved_by_fkey";
            columns: ["approved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "refunds_adjustments_ledger_transaction_id_fkey";
            columns: ["ledger_transaction_id"];
            isOneToOne: false;
            referencedRelation: "ledger_transactions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "refunds_adjustments_passenger_id_fkey";
            columns: ["passenger_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "refunds_adjustments_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "refunds_adjustments_rejected_by_fkey";
            columns: ["rejected_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "refunds_adjustments_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "refunds_adjustments_reverses_transaction_id_fkey";
            columns: ["reverses_transaction_id"];
            isOneToOne: false;
            referencedRelation: "ledger_transactions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "refunds_adjustments_second_approved_by_fkey";
            columns: ["second_approved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "refunds_adjustments_trip_id_fkey";
            columns: ["trip_id"];
            isOneToOne: false;
            referencedRelation: "trips";
            referencedColumns: ["id"];
          },
        ];
      };
      ride_request_events: {
        Row: {
          actor_id: string | null;
          actor_type: Database["public"]["Enums"]["actor_type"];
          created_at: string;
          event_data: NonNullable<Json>;
          from_status: Database["public"]["Enums"]["ride_request_status"] | null;
          id: number;
          reason: string | null;
          request_id: string;
          to_status: Database["public"]["Enums"]["ride_request_status"];
        };
        ComputedFields: never;
        Insert: {
          actor_id?: string | null;
          actor_type: Database["public"]["Enums"]["actor_type"];
          created_at?: string;
          event_data?: NonNullable<Json>;
          from_status?: Database["public"]["Enums"]["ride_request_status"] | null;
          id?: never;
          reason?: string | null;
          request_id: string;
          to_status: Database["public"]["Enums"]["ride_request_status"];
        };
        Update: {
          actor_id?: string | null;
          actor_type?: Database["public"]["Enums"]["actor_type"];
          created_at?: string;
          event_data?: NonNullable<Json>;
          from_status?: Database["public"]["Enums"]["ride_request_status"] | null;
          id?: never;
          reason?: string | null;
          request_id?: string;
          to_status?: Database["public"]["Enums"]["ride_request_status"];
        };
        Relationships: [
          {
            foreignKeyName: "ride_request_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ride_request_events_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "ride_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      ride_requests: {
        Row: {
          booked_by: string | null;
          cancel_reason: string | null;
          category_id: string;
          closed_at: string | null;
          created_at: string;
          created_by: string | null;
          destination_label: string | null;
          destination_point: unknown;
          dispatch_round: number;
          estimated_distance_m: number;
          estimated_duration_s: number;
          estimated_fare: number;
          expires_at: string;
          id: string;
          matched_at: string | null;
          passenger_id: string;
          payment_method: Database["public"]["Enums"]["payment_method"];
          pickup_label: string | null;
          pickup_note: string | null;
          pickup_point: unknown;
          quote_id: string;
          quoted_rule_id: string;
          requested_at: string;
          status: Database["public"]["Enums"]["ride_request_status"];
          updated_at: string;
          updated_by: string | null;
          version: number;
          zone_id: string;
        };
        ComputedFields: never;
        Insert: {
          booked_by?: string | null;
          cancel_reason?: string | null;
          category_id: string;
          closed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          destination_label?: string | null;
          destination_point: unknown;
          dispatch_round?: number;
          estimated_distance_m: number;
          estimated_duration_s: number;
          estimated_fare: number;
          expires_at: string;
          id?: string;
          matched_at?: string | null;
          passenger_id: string;
          payment_method?: Database["public"]["Enums"]["payment_method"];
          pickup_label?: string | null;
          pickup_note?: string | null;
          pickup_point: unknown;
          quote_id: string;
          quoted_rule_id: string;
          requested_at?: string;
          status?: Database["public"]["Enums"]["ride_request_status"];
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
          zone_id: string;
        };
        Update: {
          booked_by?: string | null;
          cancel_reason?: string | null;
          category_id?: string;
          closed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          destination_label?: string | null;
          destination_point?: unknown;
          dispatch_round?: number;
          estimated_distance_m?: number;
          estimated_duration_s?: number;
          estimated_fare?: number;
          expires_at?: string;
          id?: string;
          matched_at?: string | null;
          passenger_id?: string;
          payment_method?: Database["public"]["Enums"]["payment_method"];
          pickup_label?: string | null;
          pickup_note?: string | null;
          pickup_point?: unknown;
          quote_id?: string;
          quoted_rule_id?: string;
          requested_at?: string;
          status?: Database["public"]["Enums"]["ride_request_status"];
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
          zone_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ride_requests_booked_by_fkey";
            columns: ["booked_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ride_requests_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "vehicle_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ride_requests_passenger_id_fkey";
            columns: ["passenger_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ride_requests_quote_id_fkey";
            columns: ["quote_id"];
            isOneToOne: true;
            referencedRelation: "fare_quotes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ride_requests_quoted_rule_id_fkey";
            columns: ["quoted_rule_id"];
            isOneToOne: false;
            referencedRelation: "fare_rules";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ride_requests_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "service_zones";
            referencedColumns: ["id"];
          },
        ];
      };
      safety_evidence: {
        Row: {
          content_type: string;
          created_at: string;
          description: string | null;
          id: string;
          incident_id: string;
          sha256: string;
          size_bytes: number;
          storage_path: string;
          uploaded_by: string;
        };
        ComputedFields: never;
        Insert: {
          content_type: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          incident_id: string;
          sha256: string;
          size_bytes: number;
          storage_path: string;
          uploaded_by: string;
        };
        Update: {
          content_type?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          incident_id?: string;
          sha256?: string;
          size_bytes?: number;
          storage_path?: string;
          uploaded_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "safety_evidence_incident_id_fkey";
            columns: ["incident_id"];
            isOneToOne: false;
            referencedRelation: "safety_incidents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "safety_evidence_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      safety_incident_events: {
        Row: {
          actor_id: string | null;
          created_at: string;
          from_status: Database["public"]["Enums"]["incident_status"] | null;
          id: number;
          incident_id: string;
          note: string | null;
          to_status: Database["public"]["Enums"]["incident_status"];
        };
        ComputedFields: never;
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          from_status?: Database["public"]["Enums"]["incident_status"] | null;
          id?: never;
          incident_id: string;
          note?: string | null;
          to_status: Database["public"]["Enums"]["incident_status"];
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          from_status?: Database["public"]["Enums"]["incident_status"] | null;
          id?: never;
          incident_id?: string;
          note?: string | null;
          to_status?: Database["public"]["Enums"]["incident_status"];
        };
        Relationships: [
          {
            foreignKeyName: "safety_incident_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "safety_incident_events_incident_id_fkey";
            columns: ["incident_id"];
            isOneToOne: false;
            referencedRelation: "safety_incidents";
            referencedColumns: ["id"];
          },
        ];
      };
      safety_incidents: {
        Row: {
          acknowledged_at: string | null;
          assignee_id: string | null;
          closed_at: string | null;
          created_at: string;
          description: string | null;
          escalated_to: string | null;
          id: string;
          incident_no: number;
          kind: string;
          location: unknown;
          reported_at: string;
          reporter_id: string;
          reporter_role: Database["public"]["Enums"]["app_role"];
          resolution: string | null;
          resolved_at: string | null;
          severity: Database["public"]["Enums"]["incident_severity"];
          status: Database["public"]["Enums"]["incident_status"];
          trip_id: string | null;
          updated_at: string;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          acknowledged_at?: string | null;
          assignee_id?: string | null;
          closed_at?: string | null;
          created_at?: string;
          description?: string | null;
          escalated_to?: string | null;
          id?: string;
          incident_no?: never;
          kind?: string;
          location?: unknown;
          reported_at?: string;
          reporter_id: string;
          reporter_role: Database["public"]["Enums"]["app_role"];
          resolution?: string | null;
          resolved_at?: string | null;
          severity?: Database["public"]["Enums"]["incident_severity"];
          status?: Database["public"]["Enums"]["incident_status"];
          trip_id?: string | null;
          updated_at?: string;
          version?: number;
        };
        Update: {
          acknowledged_at?: string | null;
          assignee_id?: string | null;
          closed_at?: string | null;
          created_at?: string;
          description?: string | null;
          escalated_to?: string | null;
          id?: string;
          incident_no?: never;
          kind?: string;
          location?: unknown;
          reported_at?: string;
          reporter_id?: string;
          reporter_role?: Database["public"]["Enums"]["app_role"];
          resolution?: string | null;
          resolved_at?: string | null;
          severity?: Database["public"]["Enums"]["incident_severity"];
          status?: Database["public"]["Enums"]["incident_status"];
          trip_id?: string | null;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "safety_incidents_assignee_id_fkey";
            columns: ["assignee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "safety_incidents_reporter_id_fkey";
            columns: ["reporter_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "safety_incidents_trip_id_fkey";
            columns: ["trip_id"];
            isOneToOne: false;
            referencedRelation: "trips";
            referencedColumns: ["id"];
          },
        ];
      };
      saved_views: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          id: string;
          is_shared: boolean;
          name: string;
          owner_id: string;
          page: string;
          query: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          is_shared?: boolean;
          name: string;
          owner_id: string;
          page: string;
          query?: string;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          is_shared?: boolean;
          name?: string;
          owner_id?: string;
          page?: string;
          query?: string;
        };
        Relationships: [
          {
            foreignKeyName: "saved_views_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      service_zones: {
        Row: {
          active: boolean;
          area_km2: number;
          boundary: unknown;
          code: string;
          created_at: string;
          created_by: string | null;
          id: string;
          manual_surge_multiplier: number;
          name: string;
          timezone: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          area_km2: number;
          boundary: unknown;
          code: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          manual_surge_multiplier?: number;
          name: string;
          timezone?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          active?: boolean;
          area_km2?: number;
          boundary?: unknown;
          code?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          manual_surge_multiplier?: number;
          name?: string;
          timezone?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [];
      };
      storage_purge_queue: {
        Row: {
          bucket: string;
          id: number;
          path: string;
          purged_at: string | null;
          queued_at: string;
        };
        ComputedFields: never;
        Insert: {
          bucket: string;
          id?: never;
          path: string;
          purged_at?: string | null;
          queued_at?: string;
        };
        Update: {
          bucket?: string;
          id?: never;
          path?: string;
          purged_at?: string | null;
          queued_at?: string;
        };
        Relationships: [];
      };
      support_ticket_messages: {
        Row: {
          author_id: string | null;
          author_type: string;
          body: string;
          created_at: string;
          id: number;
          is_internal: boolean;
          ticket_id: string;
        };
        ComputedFields: never;
        Insert: {
          author_id?: string | null;
          author_type: string;
          body: string;
          created_at?: string;
          id?: never;
          is_internal?: boolean;
          ticket_id: string;
        };
        Update: {
          author_id?: string | null;
          author_type?: string;
          body?: string;
          created_at?: string;
          id?: never;
          is_internal?: boolean;
          ticket_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_ticket_messages_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_ticket_messages_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "support_tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      support_tickets: {
        Row: {
          assignee_id: string | null;
          category: string;
          channel: string;
          closed_at: string | null;
          created_at: string;
          first_response_at: string | null;
          id: string;
          priority: Database["public"]["Enums"]["ticket_priority"];
          requester_id: string;
          requester_role: Database["public"]["Enums"]["app_role"];
          resolved_at: string | null;
          sla_breach_notified_at: string | null;
          sla_due_at: string;
          status: Database["public"]["Enums"]["ticket_status"];
          subject: string;
          tags: string[];
          ticket_no: number;
          trip_id: string | null;
          updated_at: string;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          assignee_id?: string | null;
          category: string;
          channel?: string;
          closed_at?: string | null;
          created_at?: string;
          first_response_at?: string | null;
          id?: string;
          priority?: Database["public"]["Enums"]["ticket_priority"];
          requester_id: string;
          requester_role: Database["public"]["Enums"]["app_role"];
          resolved_at?: string | null;
          sla_breach_notified_at?: string | null;
          sla_due_at: string;
          status?: Database["public"]["Enums"]["ticket_status"];
          subject: string;
          tags?: string[];
          ticket_no?: never;
          trip_id?: string | null;
          updated_at?: string;
          version?: number;
        };
        Update: {
          assignee_id?: string | null;
          category?: string;
          channel?: string;
          closed_at?: string | null;
          created_at?: string;
          first_response_at?: string | null;
          id?: string;
          priority?: Database["public"]["Enums"]["ticket_priority"];
          requester_id?: string;
          requester_role?: Database["public"]["Enums"]["app_role"];
          resolved_at?: string | null;
          sla_breach_notified_at?: string | null;
          sla_due_at?: string;
          status?: Database["public"]["Enums"]["ticket_status"];
          subject?: string;
          tags?: string[];
          ticket_no?: never;
          trip_id?: string | null;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "support_tickets_assignee_id_fkey";
            columns: ["assignee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_tickets_requester_id_fkey";
            columns: ["requester_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_tickets_trip_id_fkey";
            columns: ["trip_id"];
            isOneToOne: false;
            referencedRelation: "trips";
            referencedColumns: ["id"];
          },
        ];
      };
      trip_fare_breakdowns: {
        Row: {
          base_amount: number;
          booking_fee: number;
          cancellation_amount: number;
          commission_pct: number;
          commissionable_amount: number;
          created_at: string;
          discount_amount: number;
          distance_amount: number;
          distance_m: number;
          driver_earning: number;
          duration_s: number;
          id: string;
          minimum_adjustment: number;
          platform_commission: number;
          pricing_rule_snapshot: NonNullable<Json>;
          rounding_amount: number;
          surge_amount: number;
          tax_amount: number;
          time_amount: number;
          total_amount: number;
          trip_id: string;
          waiting_amount: number;
        };
        ComputedFields: never;
        Insert: {
          base_amount: number;
          booking_fee: number;
          cancellation_amount?: number;
          commission_pct: number;
          commissionable_amount: number;
          created_at?: string;
          discount_amount?: number;
          distance_amount: number;
          distance_m: number;
          driver_earning: number;
          duration_s: number;
          id?: string;
          minimum_adjustment?: number;
          platform_commission: number;
          pricing_rule_snapshot: NonNullable<Json>;
          rounding_amount?: number;
          surge_amount: number;
          tax_amount?: number;
          time_amount: number;
          total_amount: number;
          trip_id: string;
          waiting_amount: number;
        };
        Update: {
          base_amount?: number;
          booking_fee?: number;
          cancellation_amount?: number;
          commission_pct?: number;
          commissionable_amount?: number;
          created_at?: string;
          discount_amount?: number;
          distance_amount?: number;
          distance_m?: number;
          driver_earning?: number;
          duration_s?: number;
          id?: string;
          minimum_adjustment?: number;
          platform_commission?: number;
          pricing_rule_snapshot?: NonNullable<Json>;
          rounding_amount?: number;
          surge_amount?: number;
          tax_amount?: number;
          time_amount?: number;
          total_amount?: number;
          trip_id?: string;
          waiting_amount?: number;
        };
        Relationships: [
          {
            foreignKeyName: "trip_fare_breakdowns_trip_id_fkey";
            columns: ["trip_id"];
            isOneToOne: true;
            referencedRelation: "trips";
            referencedColumns: ["id"];
          },
        ];
      };
      trip_location_points: {
        Row: {
          accuracy_m: number | null;
          actor_type: Database["public"]["Enums"]["actor_type"];
          id: number;
          location: unknown;
          recorded_at: string;
          speed_mps: number | null;
          trip_id: string;
        };
        ComputedFields: never;
        Insert: {
          accuracy_m?: number | null;
          actor_type?: Database["public"]["Enums"]["actor_type"];
          id?: never;
          location: unknown;
          recorded_at: string;
          speed_mps?: number | null;
          trip_id: string;
        };
        Update: {
          accuracy_m?: number | null;
          actor_type?: Database["public"]["Enums"]["actor_type"];
          id?: never;
          location?: unknown;
          recorded_at?: string;
          speed_mps?: number | null;
          trip_id?: string;
        };
        Relationships: [];
      };
      trip_location_points_2026_11: {
        Row: {
          accuracy_m: number | null;
          actor_type: Database["public"]["Enums"]["actor_type"];
          id: number;
          location: unknown;
          recorded_at: string;
          speed_mps: number | null;
          trip_id: string;
        };
        ComputedFields: never;
        Insert: {
          accuracy_m?: number | null;
          actor_type?: Database["public"]["Enums"]["actor_type"];
          id?: never;
          location: unknown;
          recorded_at: string;
          speed_mps?: number | null;
          trip_id: string;
        };
        Update: {
          accuracy_m?: number | null;
          actor_type?: Database["public"]["Enums"]["actor_type"];
          id?: never;
          location?: unknown;
          recorded_at?: string;
          speed_mps?: number | null;
          trip_id?: string;
        };
        Relationships: [];
      };
      trip_location_points_2026_12: {
        Row: {
          accuracy_m: number | null;
          actor_type: Database["public"]["Enums"]["actor_type"];
          id: number;
          location: unknown;
          recorded_at: string;
          speed_mps: number | null;
          trip_id: string;
        };
        ComputedFields: never;
        Insert: {
          accuracy_m?: number | null;
          actor_type?: Database["public"]["Enums"]["actor_type"];
          id?: never;
          location: unknown;
          recorded_at: string;
          speed_mps?: number | null;
          trip_id: string;
        };
        Update: {
          accuracy_m?: number | null;
          actor_type?: Database["public"]["Enums"]["actor_type"];
          id?: never;
          location?: unknown;
          recorded_at?: string;
          speed_mps?: number | null;
          trip_id?: string;
        };
        Relationships: [];
      };
      trip_location_points_2027_01: {
        Row: {
          accuracy_m: number | null;
          actor_type: Database["public"]["Enums"]["actor_type"];
          id: number;
          location: unknown;
          recorded_at: string;
          speed_mps: number | null;
          trip_id: string;
        };
        ComputedFields: never;
        Insert: {
          accuracy_m?: number | null;
          actor_type?: Database["public"]["Enums"]["actor_type"];
          id?: never;
          location: unknown;
          recorded_at: string;
          speed_mps?: number | null;
          trip_id: string;
        };
        Update: {
          accuracy_m?: number | null;
          actor_type?: Database["public"]["Enums"]["actor_type"];
          id?: never;
          location?: unknown;
          recorded_at?: string;
          speed_mps?: number | null;
          trip_id?: string;
        };
        Relationships: [];
      };
      trip_location_points_2027_02: {
        Row: {
          accuracy_m: number | null;
          actor_type: Database["public"]["Enums"]["actor_type"];
          id: number;
          location: unknown;
          recorded_at: string;
          speed_mps: number | null;
          trip_id: string;
        };
        ComputedFields: never;
        Insert: {
          accuracy_m?: number | null;
          actor_type?: Database["public"]["Enums"]["actor_type"];
          id?: never;
          location: unknown;
          recorded_at: string;
          speed_mps?: number | null;
          trip_id: string;
        };
        Update: {
          accuracy_m?: number | null;
          actor_type?: Database["public"]["Enums"]["actor_type"];
          id?: never;
          location?: unknown;
          recorded_at?: string;
          speed_mps?: number | null;
          trip_id?: string;
        };
        Relationships: [];
      };
      trip_location_points_default: {
        Row: {
          accuracy_m: number | null;
          actor_type: Database["public"]["Enums"]["actor_type"];
          id: number;
          location: unknown;
          recorded_at: string;
          speed_mps: number | null;
          trip_id: string;
        };
        ComputedFields: never;
        Insert: {
          accuracy_m?: number | null;
          actor_type?: Database["public"]["Enums"]["actor_type"];
          id?: never;
          location: unknown;
          recorded_at: string;
          speed_mps?: number | null;
          trip_id: string;
        };
        Update: {
          accuracy_m?: number | null;
          actor_type?: Database["public"]["Enums"]["actor_type"];
          id?: never;
          location?: unknown;
          recorded_at?: string;
          speed_mps?: number | null;
          trip_id?: string;
        };
        Relationships: [];
      };
      trip_notes: {
        Row: {
          author_id: string;
          body: string;
          created_at: string;
          id: string;
          trip_id: string;
        };
        ComputedFields: never;
        Insert: {
          author_id: string;
          body: string;
          created_at?: string;
          id?: string;
          trip_id: string;
        };
        Update: {
          author_id?: string;
          body?: string;
          created_at?: string;
          id?: string;
          trip_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "trip_notes_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "trip_notes_trip_id_fkey";
            columns: ["trip_id"];
            isOneToOne: false;
            referencedRelation: "trips";
            referencedColumns: ["id"];
          },
        ];
      };
      trip_status_events: {
        Row: {
          actor_id: string | null;
          actor_type: Database["public"]["Enums"]["actor_type"];
          created_at: string;
          event_data: NonNullable<Json>;
          from_status: Database["public"]["Enums"]["trip_status"] | null;
          id: number;
          location: unknown;
          reason: string | null;
          to_status: Database["public"]["Enums"]["trip_status"];
          trip_id: string;
        };
        ComputedFields: never;
        Insert: {
          actor_id?: string | null;
          actor_type: Database["public"]["Enums"]["actor_type"];
          created_at?: string;
          event_data?: NonNullable<Json>;
          from_status?: Database["public"]["Enums"]["trip_status"] | null;
          id?: never;
          location?: unknown;
          reason?: string | null;
          to_status: Database["public"]["Enums"]["trip_status"];
          trip_id: string;
        };
        Update: {
          actor_id?: string | null;
          actor_type?: Database["public"]["Enums"]["actor_type"];
          created_at?: string;
          event_data?: NonNullable<Json>;
          from_status?: Database["public"]["Enums"]["trip_status"] | null;
          id?: never;
          location?: unknown;
          reason?: string | null;
          to_status?: Database["public"]["Enums"]["trip_status"];
          trip_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "trip_status_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "trip_status_events_trip_id_fkey";
            columns: ["trip_id"];
            isOneToOne: false;
            referencedRelation: "trips";
            referencedColumns: ["id"];
          },
        ];
      };
      trips: {
        Row: {
          accepted_at: string;
          accepted_pickup_eta_s: number | null;
          actual_distance_m: number | null;
          actual_duration_s: number | null;
          arrived_at: string | null;
          arriving_at: string | null;
          cancellation_fee: number;
          cancellation_reason: string | null;
          cancelled_at: string | null;
          cancelled_by_actor: Database["public"]["Enums"]["actor_type"] | null;
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          currency: string;
          distance_source: string | null;
          driver_id: string;
          end_point: unknown;
          fare_review_required: boolean;
          fare_rule_id: string;
          final_fare: number | null;
          id: string;
          passenger_id: string;
          payment_method: Database["public"]["Enums"]["payment_method"];
          pricing_rule_snapshot: NonNullable<Json>;
          request_id: string;
          share_token_hash: string | null;
          start_pin: string | null;
          start_pin_attempts: number;
          start_point: unknown;
          started_at: string | null;
          status: Database["public"]["Enums"]["trip_status"];
          updated_at: string;
          updated_by: string | null;
          vehicle_id: string;
          version: number;
          waiting_s: number | null;
        };
        ComputedFields: never;
        Insert: {
          accepted_at?: string;
          accepted_pickup_eta_s?: number | null;
          actual_distance_m?: number | null;
          actual_duration_s?: number | null;
          arrived_at?: string | null;
          arriving_at?: string | null;
          cancellation_fee?: number;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by_actor?: Database["public"]["Enums"]["actor_type"] | null;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          distance_source?: string | null;
          driver_id: string;
          end_point?: unknown;
          fare_review_required?: boolean;
          fare_rule_id: string;
          final_fare?: number | null;
          id?: string;
          passenger_id: string;
          payment_method?: Database["public"]["Enums"]["payment_method"];
          pricing_rule_snapshot: NonNullable<Json>;
          request_id: string;
          share_token_hash?: string | null;
          start_pin?: string | null;
          start_pin_attempts?: number;
          start_point?: unknown;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["trip_status"];
          updated_at?: string;
          updated_by?: string | null;
          vehicle_id: string;
          version?: number;
          waiting_s?: number | null;
        };
        Update: {
          accepted_at?: string;
          accepted_pickup_eta_s?: number | null;
          actual_distance_m?: number | null;
          actual_duration_s?: number | null;
          arrived_at?: string | null;
          arriving_at?: string | null;
          cancellation_fee?: number;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by_actor?: Database["public"]["Enums"]["actor_type"] | null;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          distance_source?: string | null;
          driver_id?: string;
          end_point?: unknown;
          fare_review_required?: boolean;
          fare_rule_id?: string;
          final_fare?: number | null;
          id?: string;
          passenger_id?: string;
          payment_method?: Database["public"]["Enums"]["payment_method"];
          pricing_rule_snapshot?: NonNullable<Json>;
          request_id?: string;
          share_token_hash?: string | null;
          start_pin?: string | null;
          start_pin_attempts?: number;
          start_point?: unknown;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["trip_status"];
          updated_at?: string;
          updated_by?: string | null;
          vehicle_id?: string;
          version?: number;
          waiting_s?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "trips_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "driver_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "trips_fare_rule_id_fkey";
            columns: ["fare_rule_id"];
            isOneToOne: false;
            referencedRelation: "fare_rules";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "trips_passenger_id_fkey";
            columns: ["passenger_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "trips_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: true;
            referencedRelation: "ride_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "trips_vehicle_id_fkey";
            columns: ["vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id"];
          },
        ];
      };
      vehicle_categories: {
        Row: {
          active: boolean;
          code: string;
          created_at: string;
          created_by: string | null;
          description: string | null;
          icon: string;
          id: string;
          name: string;
          name_bn: string | null;
          passenger_capacity: number;
          sort_order: number;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          code: string;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          icon?: string;
          id?: string;
          name: string;
          name_bn?: string | null;
          passenger_capacity: number;
          sort_order?: number;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          active?: boolean;
          code?: string;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          icon?: string;
          id?: string;
          name?: string;
          name_bn?: string | null;
          passenger_capacity?: number;
          sort_order?: number;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [];
      };
      vehicles: {
        Row: {
          category_id: string;
          color: string;
          created_at: string;
          created_by: string | null;
          driver_id: string;
          id: string;
          make: string;
          model: string;
          registration_number: string;
          status: Database["public"]["Enums"]["vehicle_status"];
          suspended_reason: string | null;
          updated_at: string;
          updated_by: string | null;
          verified_at: string | null;
          verified_by: string | null;
          version: number;
          year: number;
        };
        ComputedFields: never;
        Insert: {
          category_id: string;
          color: string;
          created_at?: string;
          created_by?: string | null;
          driver_id: string;
          id?: string;
          make: string;
          model: string;
          registration_number: string;
          status?: Database["public"]["Enums"]["vehicle_status"];
          suspended_reason?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          verified_at?: string | null;
          verified_by?: string | null;
          version?: number;
          year: number;
        };
        Update: {
          category_id?: string;
          color?: string;
          created_at?: string;
          created_by?: string | null;
          driver_id?: string;
          id?: string;
          make?: string;
          model?: string;
          registration_number?: string;
          status?: Database["public"]["Enums"]["vehicle_status"];
          suspended_reason?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          verified_at?: string | null;
          verified_by?: string | null;
          version?: number;
          year?: number;
        };
        Relationships: [
          {
            foreignKeyName: "vehicles_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "vehicle_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vehicles_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "driver_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vehicles_verified_by_fkey";
            columns: ["verified_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      zone_surge_state: {
        Row: {
          category_id: string;
          computed_at: string;
          demand: number;
          multiplier: number;
          supply: number;
          zone_id: string;
        };
        ComputedFields: never;
        Insert: {
          category_id: string;
          computed_at?: string;
          demand?: number;
          multiplier?: number;
          supply?: number;
          zone_id: string;
        };
        Update: {
          category_id?: string;
          computed_at?: string;
          demand?: number;
          multiplier?: number;
          supply?: number;
          zone_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "zone_surge_state_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "vehicle_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "zone_surge_state_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "service_zones";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      admin_effective_permissions: {
        Row: {
          admin_id: string | null;
          permission_code: string | null;
        };
        ComputedFields: never;
        Relationships: [];
      };
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      account_status: "active" | "suspended" | "deactivated";
      actor_type: "passenger" | "driver" | "admin" | "system";
      app_role: "admin" | "driver" | "passenger" | "user";
      document_type:
        | "national_id"
        | "driving_licence"
        | "profile_photo"
        | "vehicle_registration"
        | "fitness_certificate"
        | "tax_token"
        | "insurance"
        | "route_permit";
      driver_availability: "offline" | "online" | "on_trip";
      driver_onboarding_status:
        | "draft"
        | "submitted"
        | "under_review"
        | "approved"
        | "rejected"
        | "suspended";
      earning_payout_status: "unpaid" | "in_payout" | "paid" | "held";
      fare_rule_status: "draft" | "scheduled" | "active" | "retired";
      incident_severity: "low" | "medium" | "high" | "critical";
      incident_status:
        | "reported"
        | "acknowledged"
        | "investigating"
        | "escalated"
        | "resolved"
        | "closed";
      offer_response: "pending" | "accepted" | "rejected" | "expired" | "withdrawn";
      payment_method: "cash" | "bkash" | "nagad" | "card";
      payment_status:
        | "pending"
        | "succeeded"
        | "failed"
        | "cancelled"
        | "refunded"
        | "partially_refunded";
      review_status: "pending" | "approved" | "rejected" | "expired";
      ride_request_status:
        | "requested"
        | "searching"
        | "matched"
        | "no_driver_found"
        | "cancelled_by_passenger"
        | "cancelled_by_driver"
        | "cancelled_by_admin"
        | "failed"
        | "completed";
      ticket_priority: "low" | "normal" | "high" | "urgent";
      ticket_status: "open" | "in_progress" | "pending_user" | "resolved" | "closed";
      trip_status:
        | "driver_assigned"
        | "driver_arriving"
        | "arrived"
        | "in_progress"
        | "completed"
        | "cancelled_by_passenger"
        | "cancelled_by_driver"
        | "cancelled_by_admin"
        | "failed";
      vehicle_status: "pending" | "active" | "inactive" | "suspended";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  api: {
    Enums: {},
  },
  public: {
    Enums: {
      account_status: ["active", "suspended", "deactivated"],
      actor_type: ["passenger", "driver", "admin", "system"],
      app_role: ["admin", "driver", "passenger", "user"],
      document_type: [
        "national_id",
        "driving_licence",
        "profile_photo",
        "vehicle_registration",
        "fitness_certificate",
        "tax_token",
        "insurance",
        "route_permit",
      ],
      driver_availability: ["offline", "online", "on_trip"],
      driver_onboarding_status: [
        "draft",
        "submitted",
        "under_review",
        "approved",
        "rejected",
        "suspended",
      ],
      earning_payout_status: ["unpaid", "in_payout", "paid", "held"],
      fare_rule_status: ["draft", "scheduled", "active", "retired"],
      incident_severity: ["low", "medium", "high", "critical"],
      incident_status: [
        "reported",
        "acknowledged",
        "investigating",
        "escalated",
        "resolved",
        "closed",
      ],
      offer_response: ["pending", "accepted", "rejected", "expired", "withdrawn"],
      payment_method: ["cash", "bkash", "nagad", "card"],
      payment_status: [
        "pending",
        "succeeded",
        "failed",
        "cancelled",
        "refunded",
        "partially_refunded",
      ],
      review_status: ["pending", "approved", "rejected", "expired"],
      ride_request_status: [
        "requested",
        "searching",
        "matched",
        "no_driver_found",
        "cancelled_by_passenger",
        "cancelled_by_driver",
        "cancelled_by_admin",
        "failed",
        "completed",
      ],
      ticket_priority: ["low", "normal", "high", "urgent"],
      ticket_status: ["open", "in_progress", "pending_user", "resolved", "closed"],
      trip_status: [
        "driver_assigned",
        "driver_arriving",
        "arrived",
        "in_progress",
        "completed",
        "cancelled_by_passenger",
        "cancelled_by_driver",
        "cancelled_by_admin",
        "failed",
      ],
      vehicle_status: ["pending", "active", "inactive", "suspended"],
    },
  },
} as const;
