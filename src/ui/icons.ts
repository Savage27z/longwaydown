import type { VehicleId } from '../config/vehicles';

/** Simple line icons (24x24 viewBox, stroke = currentColor via CSS). */
export const VEHICLE_ICONS: Record<VehicleId, string> = {
  bicycle:
    '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="16" r="3.8"/><circle cx="18.5" cy="16" r="3.8"/><path d="M5.5 16 9 9h6l3.5 7M9 9l3 7h-6.5M14 6h2.5M12 16l3-7"/></svg>',
  mountainBike:
    '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="16" r="4"/><circle cx="18.5" cy="16" r="4"/><path d="M5.5 16 9.5 9h5l4 7M9.5 9l2.5 7H5.5M13 5.5h3l1 2M12 16l2.5-7"/></svg>',
  motorbike:
    '<svg viewBox="0 0 24 24"><circle cx="5" cy="16" r="3.5"/><circle cx="19" cy="16" r="3.5"/><path d="M5 16h5l3-5h4l2 5M8 11h5M15 7h3l1 4"/></svg>',
  car: '<svg viewBox="0 0 24 24"><path d="M3 15v-3l2-4h11l3 4h2v3"/><circle cx="7" cy="16" r="2.5"/><circle cx="17" cy="16" r="2.5"/><path d="M7 8l1 4h8"/></svg>',
  flyingCar:
    '<svg viewBox="0 0 24 24"><path d="M3 13c2-4 5-5 9-5s7 1 9 5M3 13h18M6 13l-2 4h4M18 13l2 4h-4"/><path d="M9 8l1-3h4l1 3"/></svg>',
  snowboard: '<svg viewBox="0 0 24 24"><rect x="2" y="9" width="20" height="6" rx="3" transform="rotate(-20 12 12)"/><path d="M9 10.5l1 2M14 8.7l1 2"/></svg>',
  wingsuit:
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><path d="M12 7v7M12 9 3 14l9-1 9 1-9-5M12 14l-3 7M12 14l3 7M9 21h6"/></svg>',
  onFoot: '<svg viewBox="0 0 24 24"><circle cx="14" cy="4" r="2"/><path d="M8 21l3-6 3 2v5M11 15l1-6-4 2-2 3M12 9l4 3 3-1"/></svg>',
  skis: '<svg viewBox="0 0 24 24"><path d="M4 20 18 4c1-1 2.5 0 1.5 1M9 21 21 7c1-1 1.8.4 1 1.4M3 8l4 4M7 5l4 4"/></svg>',
};
