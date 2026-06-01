import React from 'react'
import { Modal } from '@douyinfe/semi-ui'
import type { ModalReactProps } from '@douyinfe/semi-ui/modal'
import { t } from '../../i18n'
import WKButton from '../WKButton'

export type WKConfirmProps = Omit<ModalReactProps, 'className' | 'icon'> & {
  className?: string
}

export function wkConfirm(props: WKConfirmProps) {
  const { className, okText, cancelText, okType, onOk, onCancel, ...rest } = props
  const resolvedOkText = okText ?? t('base.common.ok')
  const resolvedCancelText = cancelText ?? t('base.common.cancel')
  let modalRef: ReturnType<typeof Modal.confirm>

  const closeAfter = (result: void | Promise<unknown>) => {
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      void (result as Promise<unknown>).then(() => modalRef?.destroy())
      return
    }
    modalRef?.destroy()
  }

  modalRef = Modal.confirm({
    ...rest,
    icon: null,
    className: ['wk-modal', 'wk-modal-confirm', className].filter(Boolean).join(' '),
    modalContentClass: 'wk-modal-content',
    title: null,
    header: null,
    footer: null,
    onCancel,
    content: (
      <div className="wk-modal-confirm-shell">
        {props.title !== null && props.title !== undefined && (
          <div className="wk-modal-title wk-modal-confirm-title">{props.title}</div>
        )}
        <div className="wk-modal-confirm-body">
          {typeof props.content === 'string' ? (
            <p className="wk-modal-confirm-text">{props.content}</p>
          ) : (
            props.content
          )}
        </div>
        <div className="wk-modal-footer wk-modal-confirm-footer">
          <WKButton
            variant="secondary"
            onClick={(event) => closeAfter(onCancel?.(event) as void | Promise<unknown>)}
          >
            {resolvedCancelText}
          </WKButton>
          <WKButton
            variant={okType === 'danger' ? 'danger' : 'primary'}
            onClick={(event) => closeAfter(onOk?.(event) as void | Promise<unknown>)}
          >
            {resolvedOkText}
          </WKButton>
        </div>
      </div>
    ),
  })

  return modalRef
}
