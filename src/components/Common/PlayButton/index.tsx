import ButtonWithDropdown from '@app/components/Common/ButtonWithDropdown';
import { getSafeHref } from '@app/utils/safeUrl';

interface PlayButtonProps {
  links: PlayButtonLink[];
  buttonSize?: 'default' | 'sm';
}

export interface PlayButtonLink {
  text: string;
  url: string;
  svg: React.ReactNode;
}

const PlayButton = ({ links, buttonSize = 'default' }: PlayButtonProps) => {
  const safeLinks = links
    .map((link) => ({ ...link, url: getSafeHref(link.url) }))
    .filter((link): link is PlayButtonLink => Boolean(link.url));

  if (!safeLinks.length) {
    return null;
  }

  return (
    <ButtonWithDropdown
      as="a"
      buttonType="ghost"
      buttonSize={buttonSize}
      text={
        <>
          {safeLinks[0].svg}
          <span>{safeLinks[0].text}</span>
        </>
      }
      href={safeLinks[0].url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {safeLinks.length > 1 &&
        safeLinks.slice(1).map((link, i) => {
          return (
            <ButtonWithDropdown.Item
              key={`play-button-dropdown-item-${i}`}
              buttonType="ghost"
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {link.svg}
              <span>{link.text}</span>
            </ButtonWithDropdown.Item>
          );
        })}
    </ButtonWithDropdown>
  );
};

export default PlayButton;
