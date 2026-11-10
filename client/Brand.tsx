import logo from './conva.svg';

/** Shared mark keeps navigation, authentication, and call branding consistent. */
export function Brand({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  return <span className={`conva-brand ${className}`}>
    <img className="conva-logo" src={logo} alt={compact ? 'Conva' : ''} width={32} height={32}/>
    {!compact && <span>Conva</span>}
  </span>;
}
