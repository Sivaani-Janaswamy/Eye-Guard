import React, { useState, useEffect } from 'react';
import { db } from '@extension/db/db';
import type { CorrectionProfile, StoredCorrectionProfile } from '@extension/db/schema';
import { CORRECTION_PRESETS } from '@extension/correction/display-corrector';

export function CorrectionPanel() {
  const [profile, setProfile] = useState<StoredCorrectionProfile | null>(null);
  const [appliedPreset, setAppliedPreset] = useState<string | null>(null);

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

  useEffect(() => {
    if (appliedPreset) {
      const timer = setTimeout(() => setAppliedPreset(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [appliedPreset]);

  const handleUpdate = async (key: keyof CorrectionProfile, value: number) => {
    if (!profile) return;
    const newProfile = { ...profile, [key]: value, activePreset: "custom" as const };
    setProfile(newProfile);
    await db.correction.put(newProfile);
    chrome.runtime.sendMessage({
      type: 'APPLY_CORRECTION',
      profile: newProfile
    });
  };

  const handlePreset = async (presetId: "off" | "office" | "night") => {
    if (!profile) return;
    const newProfile = { ...profile, ...CORRECTION_PRESETS[presetId] };
    setProfile(newProfile);
    await db.correction.put(newProfile);
    chrome.runtime.sendMessage({
      type: 'APPLY_CORRECTION',
      profile: newProfile
    });
    setAppliedPreset(presetId);
  };

  if (!profile) return null;

  return (
    <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '12px' }} className="p-6 flex flex-col h-full">
      <h3 style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', fontWeight: 600, marginBottom: '24px' }}>
        Digital Correction
      </h3>

      <div className="corr-preview mb-6" style={{ background: '#f9fafb', borderRadius: '8px', padding: '14px', border: '1px solid #e5e7eb', filter: `contrast(${1 + (profile.contrastBoost || 0) * 0.4}) brightness(${1 - (profile.blueLightFilter || 0) * 0.15}) saturate(${1 - (profile.blueLightFilter || 0) * 0.3}) sepia(${(profile.blueLightFilter || 0) * 0.3})` }}>
        <div style={{ fontSize: '14px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>Preview: text sharpness & contrast</div>
        <div style={{ fontSize: '13px', color: '#6b7280', lineHeight: '1.7' }}>
          This paragraph shows how your screen will look with correction applied. The blue light filter warms the display, contrast boost improves readability.
        </div>
      </div>

      <div className="flex gap-2 mb-8" style={{ background: '#f9fafb', padding: '4px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
        {(["off", "office", "night"] as const).map(preset => (
          <button
            key={preset}
            onClick={() => handlePreset(preset)}
            style={{ fontSize: '12px', padding: '8px 16px', borderRadius: '6px', fontWeight: 500, transition: 'all 0.2s', textTransform: 'capitalize' }}
            className={profile.activePreset === preset ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-gray-100'}
          >
            {preset}
          </button>
        ))}
      </div>

      {appliedPreset && (
        <div className="mb-4 flex items-center gap-2">
          <span style={{ fontSize: '10px', padding: '4px 8px', borderRadius: '9999px', background: '#dcfce7', color: '#166534', fontWeight: 500 }}>Applied</span>
          <span style={{ fontSize: '11px', color: '#9ca3af', textTransform: 'capitalize' }}>{appliedPreset} preset active</span>
        </div>
      )}

      <div className="space-y-6 flex-1">
        <SliderControl 
          label="Contrast Boost" 
          val={profile.contrastBoost} 
          min={0} max={1} step={0.1} 
          update={v => handleUpdate('contrastBoost', v)} 
        />
        <SliderControl 
          label="Blue Light Filter" 
          val={profile.blueLightFilter} 
          min={0} max={1} step={0.1} 
          update={v => handleUpdate('blueLightFilter', v)} 
        />
        <SliderControl 
          label="Font Scaling" 
          val={profile.fontScaleFactor} 
          min={1} max={1.5} step={0.05} 
          update={v => handleUpdate('fontScaleFactor', v)} 
        />
      </div>
      
      <div style={{ color: '#9ca3af', fontSize: '10px', marginTop: '24px', fontStyle: 'italic' }}>Blue light filter is a CSS approximation.</div>
    </div>
  );
}

function SliderControl({ label, val, min, max, step, update }: { label: string, val: number, min: number, max: number, step: number, update: (v: number) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between" style={{ fontSize: '12px', fontWeight: 500, color: '#6b7280' }}>
        <span>{label}</span>
        <span style={{ color: '#374151', fontWeight: 600 }}>{(val * 100).toFixed(0)}%</span>
      </div>
      <input 
        type="range" 
        min={min} 
        max={max} 
        step={step} 
        value={val} 
        onChange={e => update(parseFloat(e.target.value))}
        className="w-full h-1.5 rounded-lg appearance-none cursor-pointer"
        style={{ accentColor: '#3b82f6', background: '#e5e7eb' }}
      />
    </div>
  );
}
