import type { ReactNode } from 'react';
import { Compass } from 'lucide-react';

type FocusMapStatusBarProps = {
  latitude: string;
  longitude: string;
  heading: string;
  compass: string;
  speed: string;
  distance: string;
  eta: string;
  weather: string;
  weatherIcon: ReactNode;
};

function Item({
  shortLabel,
  label,
  value,
  leading,
}: {
  shortLabel: string;
  label: string;
  value: ReactNode;
  leading?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      {leading}
      <span className="font-semibold text-foreground">
        <span className="md:hidden">{shortLabel}</span>
        <span className="hidden md:inline">{label}</span>
      </span>
      <span>{value}</span>
    </div>
  );
}

export function FocusMapStatusBar(props: FocusMapStatusBarProps) {
  const { latitude, longitude, heading, compass, speed, distance, eta, weather, weatherIcon } = props;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border/70 bg-card/95 px-3 py-2 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[11px] text-muted-foreground md:text-xs">
        <Item shortLabel="Lat" label="Latitude" value={latitude} />
        <Item shortLabel="Lng" label="Longitude" value={longitude} />
        <Item shortLabel="Hd" label="Heading" value={heading} />
        <Item shortLabel="Cmp" label="Compass" value={compass} leading={<Compass className="size-4 text-foreground" aria-hidden="true" />} />
        <Item shortLabel="Vel" label="Velocity" value={speed} />
        <Item shortLabel="Dst" label="Distance" value={distance} />
        <Item shortLabel="ETA" label="ETA" value={eta} />
        <Item shortLabel="Wx" label="Weather" value={weather} leading={weatherIcon} />
      </div>
    </div>
  );
}
