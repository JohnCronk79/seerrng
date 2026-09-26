import Button from '@app/components/Common/Button';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import {
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
  Transition,
} from '@headlessui/react';
import { EllipsisVerticalIcon } from '@heroicons/react/24/solid';
import { MAX_ISSUE_MESSAGE_LENGTH } from '@server/constants/issue';
import { Field, Form, Formik } from 'formik';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import ReactMarkdown from 'react-markdown';
import * as Yup from 'yup';

const messages = defineMessages('components.IssueDetails.IssueDescription', {
  description: 'Description',
  edit: 'Edit Description',
  deleteissue: 'Delete Issue',
  validationDescription: 'You must enter a description',
  validationDescriptionLength:
    'Description must be {maxLength, number} characters or fewer',
});

interface IssueDescriptionProps {
  description: string;
  belongsToUser: boolean;
  commentCount: number;
  onEdit: (newDescription: string) => void;
  onDelete: () => void;
}

const IssueDescription = ({
  description,
  belongsToUser,
  commentCount,
  onEdit,
  onDelete,
}: IssueDescriptionProps) => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const [isEditing, setIsEditing] = useState(false);
  const EditDescriptionSchema = Yup.object().shape({
    newMessage: Yup.string()
      .max(
        MAX_ISSUE_MESSAGE_LENGTH,
        intl.formatMessage(messages.validationDescriptionLength, {
          maxLength: MAX_ISSUE_MESSAGE_LENGTH,
        })
      )
      .required(intl.formatMessage(messages.validationDescription)),
  });

  return (
    <div className="relative">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-gray-100 lg:text-xl">
          {intl.formatMessage(messages.description)}
        </div>
        {(hasPermission(Permission.MANAGE_ISSUES) || belongsToUser) && (
          <Menu as="div" className="relative inline-block text-left">
            {({ open }) => (
              <>
                <div>
                  <MenuButton className="issue-options-menu-trigger">
                    <span className="sr-only">Open options</span>
                    <EllipsisVerticalIcon
                      className="issue-options-menu-trigger-icon"
                      aria-hidden="true"
                    />
                  </MenuButton>
                </div>

                <Transition
                  show={open}
                  as="div"
                  enter="transition ease-out duration-100"
                  enterFrom="opacity-0 scale-95"
                  enterTo="opacity-100 scale-100"
                  leave="transition ease-in duration-75"
                  leaveFrom="opacity-100 scale-100"
                  leaveTo="opacity-0 scale-95"
                >
                  <MenuItems
                    static
                    className="app-dropdown-menu absolute right-0 mt-2 w-56 origin-top-right focus:outline-none"
                  >
                    <div className="py-1">
                      {belongsToUser && (
                        <MenuItem>
                          {({ active }) => (
                            <button
                              onClick={() => setIsEditing(true)}
                              className={`issue-options-menu-action ${active ? 'issue-options-menu-action-active' : ''}`}
                            >
                              {intl.formatMessage(messages.edit)}
                            </button>
                          )}
                        </MenuItem>
                      )}
                      {(hasPermission(Permission.MANAGE_ISSUES) ||
                        !commentCount) && (
                        <MenuItem>
                          {({ active }) => (
                            <button
                              onClick={() => onDelete()}
                              className={`issue-options-menu-action ${active ? 'issue-options-menu-action-active' : ''}`}
                            >
                              {intl.formatMessage(messages.deleteissue)}
                            </button>
                          )}
                        </MenuItem>
                      )}
                    </div>
                  </MenuItems>
                </Transition>
              </>
            )}
          </Menu>
        )}
      </div>
      {isEditing ? (
        <Formik
          initialValues={{ newMessage: description }}
          onSubmit={(values) => {
            onEdit(values.newMessage);
            setIsEditing(false);
          }}
          validationSchema={EditDescriptionSchema}
        >
          {({ errors, touched }) => {
            return (
              <Form className="mt-4">
                <Field
                  id="newMessage"
                  name="newMessage"
                  as="textarea"
                  className="h-40"
                />
                {errors.newMessage &&
                  touched.newMessage &&
                  typeof errors.newMessage === 'string' && (
                    <div className="error">{errors.newMessage}</div>
                  )}
                <div className="mt-2 flex justify-end">
                  <Button
                    buttonType="default"
                    className="mr-2"
                    type="button"
                    onClick={() => setIsEditing(false)}
                  >
                    <span>{intl.formatMessage(globalMessages.cancel)}</span>
                  </Button>
                  <Button buttonType="primary">
                    <span>{intl.formatMessage(globalMessages.save)}</span>
                  </Button>
                </div>
              </Form>
            );
          }}
        </Formik>
      ) : (
        <div className="prose mt-4">
          <ReactMarkdown
            allowedElements={['p', 'em', 'strong', 'ul', 'ol', 'li']}
            skipHtml
          >
            {description}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
};

export default IssueDescription;
