import React, { useState, useEffect } from 'react';
import { db } from '@extension/db/db';
import type { CorrectionProfile, StoredCorrectionProfile } from '@extension/db/schema';
import { CORRECTION_PRESETS } from '@extension/correction/display-corrector';

export function CorrectionPanel() {
  const [profile, setProfile] = useState<StoredCorrectionProfile | null>(null);

  useEffect(() => {
    const loadProfile = async () => {
      let p = await db.correction.get(1);
      if (!p) {
        p = { id: 1, ...CORRECTION_PRESETS['off'] };
        await db.correction.put(p);
      }
      setProfile(p);
    };
    loadProfile();
  }, []);

  const handleUpdate = async (key: keyof CorrectionProfile, value: number) => {
    if (!profile) return;
    const newProfile = { ...profile, [key]: value, activePreset: "custom" as const };
    setProfile(newProfile);
    await db.correction.put(newProfile);
  };

  const handlePreset = async (presetId: "off" | "office" | "night") => {
    if (!profile) return;
    const newProfile = { ...profile, ...CORRECTION_PRESETS[presetId] };
    setProfile(newProfile);
    await db.correction.put(newProfile);
  };

  if (!profile) return null;

  return (
    <div className="glassmorphism p-6 rounded-2xl flex flex-col">
      <h3 className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-6">
        Digital Correction
      </h3>

      <div className="flex gap-2 mb-8 bg-white/5 p-1.5 rounded-lg border border-white/10">
        {(["off", "office", "night"] as const).map(preset => (
          <button
            key={preset}
            onClick={() => handlePreset(preset)}
            className={`flex-1 text-xs py-2 rounded-md font-semibold transition capitalize ${
              profile.activePreset === preset 
              ? 'bg-indigo-500 text-white shadow-lg' 
              : 'text-white/60 hover:bg-white/10 hover:text-white'
            }`}
          >
            {preset}
          </button>
        ))}
      </div>

      <div className="space-y-6 flex-1">
        <SliderControl 
          label="Contrast Boost" 
          val={profile.contrastBoost} 
          min={0} max={1} step={0.1} 
          update={v => handleUpdate('contrastBoost', v)} 
        />
        <SliderControl 
          label="Edge Sharpness" 
          val={profile.sharpnessLevel} 
          min={0} max={1} step={0.1} 
          update={v => handleUpdate('sharpnessLevel', v)} 
        />
        <SliderControl 
          label="Font Scaling" 
          val={profile.fontScaleFactor} 
          min={1} max={2} step={0.1} 
          update={v => handleUpdate('fontScaleFactor', v)} 
        />
        <SliderControl 
          label="Blue Light Filter" 
          val={profile.blueLightFilter} 
          min={0} max={1} step={0.1} 
          update={v => handleUpdate('blueLightFilter', v)} 
        />
      </div>
    </div>
  );
}

function SliderControl({ label, val, min, max, step, update }: { label: string, val: number, min: number, max: number, step: number, update: (v: number) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between text-xs font-medium text-white/80">
        <span>{label}</span>
        <span>{val.toFixed(1)}</span>
      </div>
      <input 
        type="range" 
        min={min} 
        max={max} 
        step={step} 
        value={val} 
        onChange={e => update(parseFloat(e.target.value))}
        className="w-full accent-indigo-500 bg-white/10 h-1.5 rounded-lg appearance-none cursor-pointer"
      />
    </div>
  );
}
