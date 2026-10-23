'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminActionApproval, adminApi } from '@/app/lib/api/admin';
import { queryKeys } from '@/app/lib/api/queryKeys';
import { Button } from '@/app/components/ui/button';
import { useStepUp } from '@/app/hooks/useStepUp';
import StepUpModal from './StepUpModal';

function getApiErrorDetails(error: unknown): {
  code?: string;
  status?: number;
} {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return {};
  }
  const response = error.response;
  if (typeof response !== 'object' || response === null) return {};

  const status =
    'status' in response && typeof response.status === 'number'
      ? response.status
      : undefined;
  const data = 'data' in response ? response.data : undefined;
  const code =
    typeof data === 'object' &&
    data !== null &&
    'code' in data &&
    typeof data.code === 'string'
      ? data.code
      : undefined;
  return { code, status };
}

export default function AdminActionApprovals() {
  const queryClient = useQueryClient();
  const stepUp = useStepUp();
  const approvalsQuery = useQuery({
    queryKey: queryKeys.admin.actionApprovals.all(),
    queryFn: adminApi.getPendingActionApprovals,
    refetchInterval: 30_000,
  });

  const approveMutation = useMutation({
    mutationFn: ({
      id,
      stepUpToken,
    }: {
      id: string;
      stepUpToken?: string;
    }) => adminApi.approveActionApproval(id, stepUpToken),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.admin.actionApprovals.all(),
      });
    },
    onError: (error: unknown, variables) => {
      const { code, status } = getApiErrorDetails(error);
      if (
        code === 'AUTH_STEP_UP_REQUIRED' ||
        code === 'AUTH_STEP_UP_EXPIRED'
      ) {
        stepUp.requestStepUp((token) => {
          approveMutation.mutate({ ...variables, stepUpToken: token });
        });
      } else if (code === 'GONE' || status === 410) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.admin.actionApprovals.all(),
        });
      }
    },
  });

  const approvals: AdminActionApproval[] = approvalsQuery.data ?? [];

  return (
    <section
      aria-labelledby="action-approvals-heading"
      className="rounded-lg bg-white p-4 shadow dark:bg-gray-800"
    >
      <div className="mb-4">
        <h2
          id="action-approvals-heading"
          className="text-lg font-semibold text-gray-900 dark:text-white"
        >
          Pending high-impact actions
        </h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Confession deletion requests require approval by an administrator
          other than the requester.
        </p>
      </div>

      {approvalsQuery.isLoading ? (
        <p role="status" className="text-sm text-gray-500">
          Loading pending approvals…
        </p>
      ) : approvalsQuery.isError ? (
        <p role="alert" className="text-sm text-red-600">
          Could not load pending approvals.
        </p>
      ) : approvals.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-300">
          No pending approvals.
        </p>
      ) : (
        <ul className="space-y-3">
          {approvals.map((approval) => {
            const expired = new Date(approval.expiresAt).getTime() <= Date.now();
            return (
              <li
                key={approval.id}
                className="flex flex-col gap-3 rounded-md border border-gray-200 p-4 dark:border-gray-700 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <p className="font-medium text-gray-900 dark:text-white">
                    Delete confession
                  </p>
                  <p className="break-all text-xs text-gray-500">
                    Target: {approval.targetId}
                  </p>
                  <p className="text-sm text-gray-700 dark:text-gray-200">
                    {approval.reason}
                  </p>
                  <p className="text-xs text-gray-500">
                    Requested by admin {approval.requestedById}; expires{' '}
                    {new Date(approval.expiresAt).toLocaleString()}
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  isLoading={
                    approveMutation.isPending &&
                    approveMutation.variables?.id === approval.id
                  }
                  disabled={expired || approveMutation.isPending}
                  onClick={() => approveMutation.mutate({ id: approval.id })}
                >
                  {expired ? 'Expired' : 'Approve and delete'}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {approveMutation.isError &&
        getApiErrorDetails(approveMutation.error).status !== 410 && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            Approval failed. The action was not completed.
          </p>
        )}

      <StepUpModal
        isOpen={stepUp.isModalOpen}
        onVerify={stepUp.verify}
        onCancel={stepUp.cancel}
        error={stepUp.error}
        isVerifying={stepUp.isVerifying}
      />
    </section>
  );
}
