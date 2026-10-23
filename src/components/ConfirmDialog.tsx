import { AlertTriangle } from 'lucide-react';
import { Button, Modal } from './ui';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  peligro?: boolean;   // false = acción normal (botón verde), true = destructiva (rojo, default)
};

export function ConfirmDialog({ open, title, message, onConfirm, onCancel, confirmLabel, peligro = true }: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} title={title} size="sm">
      <div className="flex gap-4">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${peligro ? 'bg-red-50' : 'bg-teal-50'}`}>
          <AlertTriangle size={20} className={peligro ? 'text-red-500' : 'text-teal-600'} />
        </div>
        <p className="text-slate-600 text-sm pt-2">{message}</p>
      </div>
      <div className="flex justify-end gap-3 mt-6">
        <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
        <Button variant={peligro ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel || (peligro ? 'Eliminar' : 'Confirmar')}</Button>
      </div>
    </Modal>
  );
}
