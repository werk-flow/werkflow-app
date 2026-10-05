'use client';

import Cropper, { type Area } from 'react-easy-crop';

import { Field } from '@/components/ui/field';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { parseDecimalInput } from '@/lib/ui/decimal';

// react-easy-crop's default zoom bounds; the stepper shows them as percent.
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

type ProfileAvatarCropControlsProps = {
  cropSource: string | null;
  crop: { x: number; y: number };
  zoom: number;
  setCrop: (crop: { x: number; y: number }) => void;
  setZoom: (zoom: number) => void;
  setCroppedAreaPixels: (area: Area | null) => void;
};

export function ProfileAvatarCropControls({
  cropSource,
  crop,
  zoom,
  setCrop,
  setZoom,
  setCroppedAreaPixels,
}: ProfileAvatarCropControlsProps) {
  return (
    <div className="space-y-4">
      <div className="relative h-80 overflow-hidden rounded-lg bg-black">
        {cropSource ? (
          <Cropper
            image={cropSource}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_, croppedPixels) => setCroppedAreaPixels(croppedPixels)}
          />
        ) : null}
      </div>

      <Field label="Zoom">
        <QuantityStepper
          value={String(Math.round(zoom * 100))}
          onChange={(value) => {
            const percent = parseDecimalInput(value);
            if (!Number.isFinite(percent)) return;
            setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, percent / 100)));
          }}
          min={MIN_ZOOM * 100}
          step={10}
          unitLabel="%"
        />
      </Field>
    </div>
  );
}
