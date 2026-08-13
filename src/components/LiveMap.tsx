"use client";

/**
 * LiveMap — Leaflet map rendered client-side only.
 * Import via:
 *   const LiveMap = dynamic(() => import("@/components/LiveMap"), { ssr: false });
 */

import { useEffect, useRef, useState } from "react";
import type { Circle, Map as LeafletMap, Marker } from "leaflet";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import type { VehicleLocation } from "@/context/LocationContext";

interface LiveMapProps {
  /** Primary vehicle to focus on (conductor's own position or a single tracked vehicle) */
  center?: { lat: number; lng: number };
  /** All vehicles to show as markers */
  vehicles?: VehicleLocation[];
  /** Single own-position pin (used in conductor tab) */
  ownPosition?: { lat: number; lng: number; accuracy?: number } | null;
  zoom?: number;
  className?: string;
}

// Ayacucho city center as default
const DEFAULT_CENTER = { lat: -13.1588, lng: -74.2236 };

function createVehiclePopup(vehicle: VehicleLocation): HTMLDivElement {
  const container = document.createElement("div");
  container.style.fontFamily = "system-ui";
  container.style.minWidth = "160px";

  const addLine = (text: string, options?: { bold?: boolean; muted?: boolean }) => {
    const line = document.createElement("p");
    line.textContent = text;
    line.style.margin = "0 0 2px";
    line.style.fontSize = options?.muted ? "10px" : "11px";
    line.style.color = options?.muted ? "#999" : "#555";
    if (options?.bold) {
      line.style.fontWeight = "900";
      line.style.fontSize = "13px";
      line.style.color = "#111";
      line.style.marginBottom = "4px";
    }
    container.append(line);
  };

  addLine(vehicle.placa, { bold: true });
  addLine(`Conductor: ${vehicle.conductorName}`);
  addLine(`Ruta: ${vehicle.routeLabel}`);
  if (vehicle.speed !== null) addLine(`Velocidad: ${vehicle.speed} km/h`);
  addLine(new Date(vehicle.timestamp).toLocaleTimeString(), { muted: true });
  return container;
}

export default function LiveMap({
  center,
  vehicles = [],
  ownPosition = null,
  zoom = 13,
  className = "w-full h-80 rounded-2xl",
}: LiveMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const ownMarkerRef = useRef<Marker | null>(null);
  const accuracyCircleRef = useRef<Circle | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const initialCenterRef = useRef(center ?? ownPosition ?? DEFAULT_CENTER);
  const initialZoomRef = useRef(zoom);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    let isMounted = true;
    const container = mapContainerRef.current;

    // Dynamic import to avoid SSR window errors
    import("leaflet").then((L) => {
      if (!isMounted || !container || mapRef.current) return;

      // Fix Leaflet's default icon path when bundled with webpack/Next.js
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: markerIcon2x.src,
        iconUrl: markerIcon.src,
        shadowUrl: markerShadow.src,
      });

      const initialCenter = initialCenterRef.current;
      const map = L.map(container, {
        center: [initialCenter.lat, initialCenter.lng],
        zoom: initialZoomRef.current,
        zoomControl: true,
        attributionControl: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      mapRef.current = map;
      setIsMapReady(true);
    });

    const markers = markersRef.current;
    return () => {
      isMounted = false;
      mapRef.current?.remove();
      mapRef.current = null;
      markers.clear();
      ownMarkerRef.current = null;
      accuracyCircleRef.current = null;
    };
  }, []);

  // ── Update own-position marker ──────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !isMapReady) return;

    if (!ownPosition) {
      if (ownMarkerRef.current) {
        mapRef.current.removeLayer(ownMarkerRef.current);
        ownMarkerRef.current = null;
      }
      if (accuracyCircleRef.current) {
        mapRef.current.removeLayer(accuracyCircleRef.current);
        accuracyCircleRef.current = null;
      }
      return;
    }

    import("leaflet").then((L) => {
      const map = mapRef.current;
      if (!map) return;
      const { lat, lng, accuracy } = ownPosition;

      // Custom pulse icon for own position
      const ownIcon = L.divIcon({
        html: `
          <div style="position:relative;width:36px;height:36px;">
            <div style="position:absolute;inset:0;border-radius:50%;background:rgba(16,185,129,0.2);animation:pulse 2s infinite;"></div>
            <div style="position:absolute;inset:6px;border-radius:50%;background:#10b981;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div>
          </div>
          <style>@keyframes pulse{0%,100%{transform:scale(1);opacity:.6}50%{transform:scale(1.8);opacity:0}}</style>
        `,
        className: "",
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });

      if (ownMarkerRef.current) {
        ownMarkerRef.current.setLatLng([lat, lng]);
      } else {
        ownMarkerRef.current = L.marker([lat, lng], { icon: ownIcon })
          .addTo(map)
          .bindPopup("<b>📍 Tu posición actual</b>");
      }

      // Accuracy circle
      if (accuracyCircleRef.current) {
        accuracyCircleRef.current.setLatLng([lat, lng]);
        if (accuracy) accuracyCircleRef.current.setRadius(accuracy);
      } else if (accuracy) {
        accuracyCircleRef.current = L.circle([lat, lng], {
          radius: accuracy,
          color: "#10b981",
          fillColor: "#10b981",
          fillOpacity: 0.08,
          weight: 1,
        }).addTo(map);
      }

      map.setView([lat, lng], map.getZoom());
    });
  }, [isMapReady, ownPosition]);

  // ── Update vehicle markers ──────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !isMapReady) return;

    import("leaflet").then((L) => {
      const map = mapRef.current;
      if (!map) return;
      const visibleVehicleIds = new Set(vehicles.map((vehicle) => vehicle.conductorId));

      for (const [conductorId, marker] of markersRef.current) {
        if (!visibleVehicleIds.has(conductorId)) {
          map.removeLayer(marker);
          markersRef.current.delete(conductorId);
        }
      }

      vehicles.forEach((v) => {
        const iconHtml = `
          <div style="
            background:${v.isActive ? "#10b981" : "#64748b"};
            border:2px solid white;
            border-radius:8px;
            width:34px;height:34px;
            display:flex;align-items:center;justify-content:center;
            font-size:18px;box-shadow:0 2px 8px rgba(0,0,0,0.35);
          ">🚐</div>
        `;
        const vehicleIcon = L.divIcon({
          html: iconHtml,
          className: "",
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        });

        const popupContent = createVehiclePopup(v);

        if (markersRef.current.has(v.conductorId)) {
          const m = markersRef.current.get(v.conductorId)!;
          m.setLatLng([v.lat, v.lng]);
          m.setIcon(vehicleIcon);
          m.setPopupContent(popupContent);
        } else {
          const m = L.marker([v.lat, v.lng], { icon: vehicleIcon })
            .addTo(map)
            .bindPopup(popupContent);
          markersRef.current.set(v.conductorId, m);
        }
      });

      // Center map if a center override is provided
      if (center) {
        map.setView([center.lat, center.lng], map.getZoom());
      } else if (vehicles.length === 1) {
        map.setView([vehicles[0].lat, vehicles[0].lng], map.getZoom());
      } else if (vehicles.length > 1) {
        const bounds = L.latLngBounds(vehicles.map(v => [v.lat, v.lng]));
        map.fitBounds(bounds, { padding: [40, 40] });
      }
    });
  }, [vehicles, center, isMapReady]);

  return (
    <div ref={mapContainerRef} className={className} style={{ zIndex: 0 }} />
  );
}
