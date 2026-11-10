import { AdvancedVansWorkspace } from '@/components/vans/advanced-vans-workspace';

export default function VansPage() {
  return (
    <div className="realVanPhotoPreview">
      <AdvancedVansWorkspace />
      <style>{`
        .realVanPhotoPreview [aria-label="Van illustration"] {
          background: url('/fleet/demac-van-real.webp?v=20260828-4') center / cover no-repeat !important;
        }
        .realVanPhotoPreview [aria-label="Van illustration"] > svg {
          display: none !important;
        }
      `}</style>
    </div>
  );
}
