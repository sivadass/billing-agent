import { Avatar, Dropdown, MenuList, Typography } from 'cleanplate';
import type { CSSProperties } from 'react';
import { getAccessToken } from '../lib/auth-token';
import { decodeAccessToken } from '../lib/decode-access-token';

const ACCOUNT_META_STYLE: CSSProperties = {
  padding: 'var(--space-2) var(--space-4) var(--space-3) var(--space-4)',
  marginBottom: 'var(--space-2)',
  borderBottom: '1px solid var(--gray-100)',
};

const LOGOUT_ITEM = [{ label: 'Log out', value: '#logout', icon: 'logout' as const }];

export type UserAccountMenuProps = {
  onLogout: () => void;
};

function AccountMenuContent({
  emailLabel,
  onLogout,
  onClose,
}: {
  emailLabel: string;
  onLogout: () => void;
  onClose?: () => void;
}) {
  return (
    <>
      <div style={ACCOUNT_META_STYLE}>
        <Typography variant="small" margin="0" style={{ color: 'var(--text-muted)' }}>
          Signed in as &nbsp;
        </Typography>
        <Typography
          variant="small"
          margin="t-2"
          wordBreak="wrap"
          style={{ color: 'var(--text-subtle)' }}
        >
          {emailLabel}
        </Typography>
      </div>
      <MenuList
        items={LOGOUT_ITEM}
        direction="vertical"
        variant="light"
        size="small"
        margin="0"
        onMenuClick={() => {
          onLogout();
          onClose?.();
        }}
      />
    </>
  );
}

export function UserAccountMenu({ onLogout }: UserAccountMenuProps) {
  const token = getAccessToken();
  const decoded = token ? decodeAccessToken(token) : null;
  const email = decoded?.email;
  const avatarName = email ?? 'User';
  const emailLabel = email ?? 'Unable to load email';

  return (
    <Dropdown
      placement="bottom-end"
      offset={8}
      trigger={
        <Avatar
          name={avatarName}
          size="medium"
          margin="0"
          tabIndex={0}
          aria-label="Account menu"
        />
      }
      content={<AccountMenuContent emailLabel={emailLabel} onLogout={onLogout} />}
    />
  );
}
