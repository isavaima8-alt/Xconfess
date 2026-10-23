'use client';

import AdminActionApprovals from '@/app/components/admin/AdminActionApprovals';

export default function AdminActionApprovalsPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Admin</p>
        <h1 className="mt-2 text-2xl font-bold text-[var(--foreground)]">
          Action approvals
        </h1>
      </div>
      <AdminActionApprovals />
    </div>
  );
}
