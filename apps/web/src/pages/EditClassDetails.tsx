import { zodResolver } from '@hookform/resolvers/zod';
import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { UpdateClassSchema, type ClassSummary } from '@edugemini/shared';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { TextAreaField } from '../components/ui/TextAreaField';
import { TextField } from '../components/ui/TextField';
import { useUpdateClass } from '../hooks/use-classes';
import { showApiError } from '../lib/form-errors';

const SHOWN_FIELDS = ['name', 'description', 'section', 'subject', 'room'];

type UpdateClass = ReturnType<typeof useUpdateClass>;

/** The form, in a component of its own so it starts again from the saved details each time the dialog opens. */
function EditForm({ cls, updateClass, onDone }: { cls: ClassSummary; updateClass: UpdateClass; onDone: () => void }) {
  const [formError, setFormError] = useState<string>();
  const { register, handleSubmit, setError, formState } = useForm({
    resolver: zodResolver(UpdateClassSchema),
    defaultValues: {
      name: cls.name,
      description: cls.description ?? '',
      section: cls.section ?? '',
      subject: cls.subject ?? '',
      room: cls.room ?? '',
    },
    mode: 'onBlur',
  });
  const { errors } = formState;

  // All five are sent, so a field the instructor emptied is cleared (API Spec CLS-04).
  const onSubmit = handleSubmit((values) => {
    setFormError(undefined);
    updateClass.mutate(values, {
      onSuccess: onDone,
      onError: (error) => showApiError(error, setError, setFormError, SHOWN_FIELDS),
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {formError && <Alert>{formError}</Alert>}
      <TextField label="Class name" {...register('name')} error={errors.name?.message} />
      <TextAreaField label="Description (optional)" {...register('description')} error={errors.description?.message} />
      <TextField label="Section (optional)" {...register('section')} error={errors.section?.message} />
      <TextField label="Subject (optional)" {...register('subject')} error={errors.subject?.message} />
      <TextField label="Room (optional)" {...register('room')} error={errors.room?.message} />
      <div className="flex flex-wrap justify-end gap-2">
        <Dialog.Close asChild>
          <Button variant="secondary" disabled={updateClass.isPending}>
            Cancel
          </Button>
        </Dialog.Close>
        <Button type="submit" loading={updateClass.isPending}>
          Save changes
        </Button>
      </div>
    </form>
  );
}

/** The Class details card on Overview, with the dialog that edits them (UX Brief, Class Overview). Not shown for an archived class. */
export function EditClassDetails({ cls }: { cls: ClassSummary }) {
  const [open, setOpen] = useState(false);
  const updateClass = useUpdateClass(cls.id);
  // While the save runs the dialog stays open, so a failure is shown in the form, not lost (UX Brief §12), as ConfirmDialog.
  const stayWhileSaving = (event: Event) => {
    if (updateClass.isPending) event.preventDefault();
  };

  return (
    <section className="space-y-4 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-title font-semibold">Class details</h2>
      <p>Change the name, description, section, subject or room. The class code and your students are not affected.</p>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <Button variant="secondary">Edit class details</Button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay" />
          {/* A sheet from the bottom on phones, centered and at most 560 px wide from tablets up, as ConfirmDialog (UX Brief §14). */}
          <Dialog.Content
            onEscapeKeyDown={stayWhileSaving}
            onInteractOutside={stayWhileSaving}
            className="fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] space-y-4 overflow-y-auto rounded-t-lg border border-border bg-surface p-6 shadow-overlay sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-140 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg">
            <Dialog.Title className="text-title font-semibold">Edit class details</Dialog.Title>
            <Dialog.Description>The class code and your students are not affected.</Dialog.Description>
            <EditForm cls={cls} updateClass={updateClass} onDone={() => setOpen(false)} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
