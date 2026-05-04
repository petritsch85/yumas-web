export type ProductType = 'raw_material' | 'semi_finished' | 'finished' | 'menu_item';
export type UserRole = 'admin' | 'manager' | 'staff';
export type POStatus = 'draft' | 'pending_approval' | 'approved' | 'sent' | 'confirmed' | 'partial' | 'received' | 'cancelled';
export type TransferStatus = 'pending' | 'in_transit' | 'received';
export type WasteReason = 'expired' | 'damaged' | 'spoiled' | 'other';
export type ProductionStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';

export interface Item {
  id: string; name: string; sku: string | null;
  category_id: string | null; unit_id: string | null;
  description: string | null; product_type: ProductType | null;
  product_group: string | null; is_purchasable: boolean;
  is_produced: boolean; is_active: boolean; image_url: string | null;
  category?: { id: string; name: string; color_hex: string | null };
  unit?: { id: string; name: string; abbreviation: string };
}

export interface Supplier {
  id: string; name: string; contact_name: string | null;
  email: string | null; phone: string | null; address: string | null;
  payment_terms: string | null; is_active: boolean; created_at: string;
}

export interface SupplierProduct {
  id: string; supplier_id: string; display_name: string;
  einheit: string; item_id: string | null;
  unit_price: number | null; is_active: boolean; created_at: string;
}

export interface PurchaseOrder {
  id: string; po_number: string; supplier_id: string;
  destination_location_id: string; ordered_by: string;
  status: POStatus; order_date: string;
  expected_delivery_date: string | null; notes: string | null;
  created_at: string;
  supplier?: Supplier;
  destination_location?: { id: string; name: string };
  lines?: PurchaseOrderLine[];
}

export interface PurchaseOrderLine {
  id: string; po_id: string; item_id: string | null;
  supplier_product_id: string | null; display_name: string | null;
  einheit: string | null; quantity_ordered: number;
  quantity_received: number; unit_price: number;
  line_total: number; notes: string | null;
  item?: Item;
  supplier_product?: SupplierProduct;
}

export interface WasteLog {
  id: string; location_id: string; item_id: string;
  quantity: number; reason: WasteReason; logged_by: string;
  waste_date: string; unit_cost: number | null; notes: string | null;
  created_at: string;
  item?: Item;
  location?: { id: string; name: string };
}

export interface Transfer {
  id: string; transfer_number: string;
  from_location_id: string; to_location_id: string;
  status: TransferStatus; transfer_date: string; notes: string | null;
  created_at: string;
  from_location?: { id: string; name: string };
  to_location?: { id: string; name: string };
}

export interface AppPermissions {
  inventory:    boolean;
  production:   boolean;
  buying:       boolean;
  waste_log:    boolean;
  delivery:     boolean;
  analysis:     boolean;
  events:       boolean;
  staff_videos: boolean;
  bills:        boolean;
  pl_reports:   boolean;
  suppliers:    boolean;
  products:     boolean;
  recipe_edit:  boolean;
}

export interface Profile {
  id: string; full_name: string; role: UserRole;
  location_id: string | null; is_active: boolean;
  permissions?: Partial<AppPermissions>;
}
