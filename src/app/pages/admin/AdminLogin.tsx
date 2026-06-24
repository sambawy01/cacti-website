import React, { useState } from 'react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { verifyPassword, setStoredPassword, setStoredRole, Role } from '@/services/adminService';
import { AdminLang } from './useAdminLang';

interface AdminLoginProps {
  onLogin: (role: Role) => void;
  l: AdminLang;
}

export function AdminLogin({ onLogin, l }: AdminLoginProps) {
  const { tr } = l;
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;

    setLoading(true);
    setError('');

    try {
      const result = await verifyPassword(password.trim());
      if (result.valid && result.role) {
        setStoredPassword(password.trim());
        setStoredRole(result.role);
        onLogin(result.role);
      } else {
        setError(tr('invalid_password'));
      }
    } catch {
      setError(tr('connection_error'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f5f0]">
      <div className="w-full max-w-sm mx-auto p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-[#0a0a0a]">{tr('bistro_cloud')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{tr('admin_panel')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Input
              type="password"
              placeholder={tr('enter_password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              disabled={loading}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? tr('verifying') : tr('sign_in')}
          </Button>
        </form>
      </div>
    </div>
  );
}
