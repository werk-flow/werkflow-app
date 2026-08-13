'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { PlanningConflict } from '@/lib/planning/types';

type PlanningApproval = { fingerprint: string; reason: string };

export function usePlanningWarningConfirmation(): {
  requestApproval: (
    conflicts: PlanningConflict[],
    fingerprint: string
  ) => Promise<PlanningApproval | null>;
  warningDialog: React.ReactNode;
} {
  const [request, setRequest] = useState<{
    conflicts: PlanningConflict[];
    fingerprint: string;
  } | null>(null);
  const [reason, setReason] = useState('');
  const resolverRef = useRef<
    ((approval: PlanningApproval | null) => void) | null
  >(null);

  const requestApproval = useCallback(
    (conflicts: PlanningConflict[], fingerprint: string) =>
      new Promise<PlanningApproval | null>((resolve) => {
        resolverRef.current?.(null);
        resolverRef.current = resolve;
        setReason('');
        setRequest({ conflicts, fingerprint });
      }),
    []
  );
  const finish = useCallback((approval: PlanningApproval | null) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setRequest(null);
    resolve?.(approval);
  }, []);
  useEffect(
    () => () => {
      resolverRef.current?.(null);
      resolverRef.current = null;
    },
    []
  );

  return {
    requestApproval,
    warningDialog: request ? (
      <Dialog open onOpenChange={(open) => !open && finish(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-yellow-600 dark:text-yellow-400" />
              Planungshinweise prüfen
            </DialogTitle>
            <DialogDescription>
              Die Änderung bleibt möglich. WerkFlow dokumentiert eine bewusste
              Abweichung mit ihrer Begründung.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-64 space-y-2 overflow-y-auto text-sm">
            {request.conflicts.map((conflict, index) => (
              <li
                key={`${conflict.kind}-${conflict.employeeRecordId}-${conflict.localDate}-${index}`}
                className="rounded-md border bg-muted/30 px-3 py-2"
              >
                <p className="font-medium">{conflict.message}</p>
                {conflict.localDate && (
                  <p className="text-xs text-muted-foreground">
                    {conflict.localDate}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <div className="space-y-2">
            <Label htmlFor="planning-warning-reason">Kurze Begründung</Label>
            <Textarea
              id="planning-warning-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="z. B. abgestimmter Notdiensteinsatz"
              maxLength={1000}
            />
            <p className="text-xs text-muted-foreground">Mindestens 8 Zeichen.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => finish(null)}>
              Änderung zurücknehmen
            </Button>
            <Button
              disabled={reason.trim().length < 8}
              onClick={() =>
                finish({
                  fingerprint: request.fingerprint,
                  reason: reason.trim(),
                })
              }
            >
              Mit Begründung speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ) : null,
  };
}
