// Map UI module: full map and galaxy bindings (ESM)

import { openMapModal } from './map-modal.js';

export function openMap(tab = 'solar-system') {
    try { openMapModal(tab); } catch {}
}

