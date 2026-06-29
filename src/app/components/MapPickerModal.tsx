import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MapPin, Navigation, Search, Save, X, Check } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────
export interface SavedAddress {
  id: string;
  name: string;
  address: string;
  location: string; // "lat,lng" or Google Maps link
  lat?: number;
  lng?: number;
  mapsLink?: string;
}

export function loadAddressBook(): SavedAddress[] {
  try {
    const raw = localStorage.getItem('cacti_addresses');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveAddressBook(addrs: SavedAddress[]) {
  localStorage.setItem('cacti_addresses', JSON.stringify(addrs));
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Parse a Google Maps URL or "lat,lng" string into coordinates */
function parseCoords(input: string): { lat: number; lng: number } | null {
  // Try "lat,lng" format
  const m = input.match(/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
  if (m) {
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  return null;
}

/** Build a Google Maps embed URL from coordinates */
function embedUrl(lat: number, lng: number, zoom = 15): string {
  return `https://maps.google.com/maps?q=${lat},${lng}&z=${zoom}&output=embed`;
}

/** Build a Google Maps link URL from coordinates */
function mapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

/** Reverse geocode using free Nominatim (OpenStreetMap) — returns a display address */
async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=16`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const data = await res.json();
    return data?.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}

/** Forward geocode using Nominatim — search address → coordinates */
async function forwardGeocode(query: string): Promise<{ lat: number; lng: number; display: string } | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const data = await res.json();
    if (data && data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), display: data[0].display_name };
    }
    return null;
  } catch { return null; }
}

// ── Component ─────────────────────────────────────────────────────────

interface MapPickerModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (data: { location: string; address: string; lat?: number; lng?: number }) => void;
  initialLocation?: string;
  initialAddress?: string;
}

export function MapPickerModal({ open, onClose, onConfirm, initialLocation, initialAddress }: MapPickerModalProps) {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [coords, setCoords] = React.useState<{ lat: number; lng: number } | null>(null);
  const [displayAddress, setDisplayAddress] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [gpsLoading, setGpsLoading] = React.useState(false);
  const [searchLoading, setSearchLoading] = React.useState(false);
  const [saveName, setSaveName] = React.useState('');
  const [savedList, setSavedList] = React.useState<SavedAddress[]>([]);
  const [showSaveBox, setShowSaveBox] = React.useState(false);
  const [justSaved, setJustSaved] = React.useState(false);

  // Initialize from existing data when modal opens
  React.useEffect(() => {
    if (!open) return;
    setSavedList(loadAddressBook());
    setJustSaved(false);
    setShowSaveBox(false);
    setSaveName('');
    if (initialLocation) {
      const parsed = parseCoords(initialLocation);
      if (parsed) {
        setCoords(parsed);
        setDisplayAddress(initialAddress || '');
      } else if (initialLocation.startsWith('http')) {
        // Try to parse coords from a maps URL
        const m = initialLocation.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/) ||
                  initialLocation.match(/q=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
        if (m) {
          const c = { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
          setCoords(c);
          setDisplayAddress(initialAddress || '');
        }
      }
    }
  }, [open]); // eslint-disable-line

  // Use browser GPS
  const useGps = () => {
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCoords(c);
        const addr = await reverseGeocode(c.lat, c.lng);
        setDisplayAddress(addr);
        setGpsLoading(false);
      },
      (err) => {
        alert('Could not get your location. Please search for your address instead.');
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Search for an address
  const doSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    const result = await forwardGeocode(searchQuery.trim());
    setSearchLoading(false);
    if (result) {
      setCoords({ lat: result.lat, lng: result.lng });
      setDisplayAddress(result.display);
    } else {
      // Fallback: open Google Maps search in a new tab so user can get a link
      window.open(`https://www.google.com/maps/search/${encodeURIComponent(searchQuery.trim())}`, '_blank');
      alert('Couldn\'t find that exact location. A Google Maps search opened in a new tab — find your spot, copy the link, and paste it in the location field.');
    }
  };

  // Save current location to address book
  const saveToBook = () => {
    if (!saveName.trim() || !coords) return;
    const entry: SavedAddress = {
      id: `addr_${Date.now()}`,
      name: saveName.trim(),
      address: displayAddress,
      location: `${coords.lat},${coords.lng}`,
      lat: coords.lat,
      lng: coords.lng,
      mapsLink: mapsLink(coords.lat, coords.lng),
    };
    const updated = [...savedList, entry];
    setSavedList(updated);
    saveAddressBook(updated);
    setJustSaved(true);
    setShowSaveBox(false);
    setSaveName('');
    setTimeout(() => setJustSaved(false), 2000);
  };

  // Select a saved address
  const selectSaved = (addr: SavedAddress) => {
    if (addr.lat && addr.lng) {
      setCoords({ lat: addr.lat, lng: addr.lng });
    } else {
      const parsed = parseCoords(addr.location);
      if (parsed) setCoords(parsed);
    }
    setDisplayAddress(addr.address);
  };

  // Delete a saved address
  const deleteSaved = (id: string) => {
    const updated = savedList.filter(a => a.id !== id);
    setSavedList(updated);
    saveAddressBook(updated);
  };

  // Confirm selection
  const handleConfirm = () => {
    if (!coords) {
      alert('Please pick a location on the map first.');
      return;
    }
    onConfirm({
      location: mapsLink(coords.lat, coords.lng),
      address: displayAddress,
      lat: coords.lat,
      lng: coords.lng,
    });
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black z-[60] backdrop-blur-sm"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 pointer-events-none"
          >
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto pointer-events-auto">
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b bg-[#0a0a0a] rounded-t-2xl">
                <h2 className="font-montserrat font-bold text-lg text-white flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-[#0a4d4d]" />
                  Pick your location
                </h2>
                <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 space-y-4">
                {/* Saved addresses dropdown */}
                {savedList.length > 0 && (
                  <div>
                    <label className="text-xs font-semibold text-gray-600 mb-1 block">Saved addresses</label>
                    <div className="space-y-2">
                      {savedList.map((addr) => (
                        <div key={addr.id} className="flex items-center gap-2 bg-[#f5f5f0] rounded-lg p-2.5 group">
                          <button
                            onClick={() => selectSaved(addr)}
                            className="flex-1 text-left flex items-center gap-2"
                          >
                            <MapPin className="w-4 h-4 text-[#0a4d4d] shrink-0" />
                            <div className="min-w-0">
                              <p className="font-semibold text-sm text-gray-800">{addr.name}</p>
                              <p className="text-xs text-gray-500 truncate">{addr.address}</p>
                            </div>
                          </button>
                          <button
                            onClick={() => deleteSaved(addr.id)}
                            className="p-1.5 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Search bar */}
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">Search your address or area</label>
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && doSearch()}
                        placeholder="e.g. Marsa Baghush, or street name…"
                        className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0a4d4d]/20 focus:border-[#0a4d4d]"
                      />
                    </div>
                    <button
                      onClick={doSearch}
                      disabled={searchLoading || !searchQuery.trim()}
                      className="px-4 py-2.5 bg-[#0a4d4d] text-white rounded-lg text-sm font-semibold disabled:opacity-50 hover:bg-[#0a4d4d]/90"
                    >
                      {searchLoading ? '…' : 'Search'}
                    </button>
                  </div>
                </div>

                {/* GPS button */}
                <button
                  onClick={useGps}
                  disabled={gpsLoading}
                  className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-[#0a4d4d]/20 rounded-lg text-sm font-semibold text-[#0a4d4d] hover:bg-[#0a4d4d]/5 disabled:opacity-50"
                >
                  <Navigation className="w-4 h-4" />
                  {gpsLoading ? 'Getting your location…' : 'Use my current location (GPS)'}
                </button>

                {/* Map embed */}
                {coords ? (
                  <div className="rounded-xl overflow-hidden border border-gray-200">
                    <iframe
                      src={embedUrl(coords.lat, coords.lng)}
                      width="100%"
                      height="240"
                      style={{ border: 0 }}
                      loading="lazy"
                      title="Selected location"
                    />
                  </div>
                ) : (
                  <div className="rounded-xl border-2 border-dashed border-gray-200 h-[240px] flex flex-col items-center justify-center text-gray-400">
                    <MapPin className="w-10 h-10 mb-2" />
                    <p className="text-sm">Search or use GPS to pick a location</p>
                  </div>
                )}

                {/* Selected address display */}
                {displayAddress && (
                  <div className="bg-[#f5f5f0] rounded-lg p-3 flex items-start gap-2">
                    <MapPin className="w-4 h-4 text-[#0a4d4d] shrink-0 mt-0.5" />
                    <p className="text-sm text-gray-700">{displayAddress}</p>
                  </div>
                )}

                {/* Save to address book */}
                {coords && (
                  <div>
                    {showSaveBox ? (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={saveName}
                          onChange={(e) => setSaveName(e.target.value)}
                          placeholder="Name this address (e.g. Home, Villa, Beach House)"
                          className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#0a4d4d]/20 focus:border-[#0a4d4d]"
                          onKeyDown={(e) => e.key === 'Enter' && saveToBook()}
                        />
                        <button
                          onClick={saveToBook}
                          disabled={!saveName.trim()}
                          className="px-3 py-2 bg-[#0a4d4d] text-white rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center gap-1"
                        >
                          <Save className="w-3.5 h-3.5" /> Save
                        </button>
                      </div>
                    ) : justSaved ? (
                      <p className="text-xs text-green-600 flex items-center gap-1 font-medium">
                        <Check className="w-3.5 h-3.5" /> Saved to your address book!
                      </p>
                    ) : (
                      <button
                        onClick={() => setShowSaveBox(true)}
                        className="text-sm text-[#0a4d4d] font-semibold flex items-center gap-1 hover:underline"
                      >
                        <Save className="w-4 h-4" /> Save this location to my address book
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="p-4 border-t bg-[#f5f5f0] rounded-b-2xl flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={!coords}
                  className="flex-1 py-3 rounded-xl bg-[#0a4d4d] text-white font-bold text-sm disabled:opacity-50 hover:bg-[#0a4d4d]/90 flex items-center justify-center gap-2"
                >
                  <Check className="w-4 h-4" /> Confirm location
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}