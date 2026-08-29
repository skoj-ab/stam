/**
 * The Stam design system.
 *
 * Everything the application renders comes from here. Feature code imports
 * `{ Button, Table, Field } from "../ui"` — never from a component file
 * directly, and never from `@base-ui-components/react`.
 *
 * Read `docs/design-system.md` before adding to or deviating from this set.
 */

export { Badge, type BadgeProps, type BadgeTone } from "./Badge";
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from "./Button";
export { Callout, type CalloutProps, type CalloutTone } from "./Callout";
export {
  Checkbox,
  type CheckboxProps,
  RadioGroup,
  type RadioGroupProps,
  type RadioOption,
  Switch,
  type SwitchProps,
} from "./Choice";
export { Combobox, type ComboboxOption, type ComboboxProps } from "./Combobox";
export { cn } from "./cn";
export { DateField, type DateFieldProps } from "./DateField";
export { ConfirmDialog, type ConfirmDialogProps, Dialog, type DialogProps } from "./Dialog";
export { EmptyState, type EmptyStateProps } from "./EmptyState";
export {
  Field,
  type FieldProps,
  Fieldset,
  type FieldsetProps,
  FormActions,
  type FormActionsProps,
} from "./Field";
export {
  formatCount,
  formatDate,
  formatDecimal,
  formatPercentage,
  formatShareRange,
  formatTimestamp,
} from "./format";
export { IconButton, type IconButtonProps } from "./IconButton";
export { Input, type InputProps, Textarea, type TextareaProps } from "./Input";
export * from "./icons";
export { LinkButton, type LinkButtonProps, linkButtonClass } from "./LinkButton";
export {
  Menu,
  MenuCheckboxItem,
  type MenuCheckboxItemProps,
  MenuGroup,
  MenuItem,
  type MenuItemProps,
  type MenuProps,
  MenuSeparator,
} from "./Menu";
export { Pagination, type PaginationProps } from "./Pagination";
export {
  DescriptionList,
  type DescriptionListProps,
  Panel,
  type PanelProps,
} from "./Panel";
export {
  Popover,
  type PopoverProps,
  Tooltip,
  type TooltipProps,
  TooltipProvider,
} from "./Popover";
export { Select, type SelectOption, type SelectProps } from "./Select";
export { Separator, type SeparatorProps } from "./Separator";
export { Skeleton, type SkeletonProps, SkeletonRows } from "./Skeleton";
export { Spinner, type SpinnerProps } from "./Spinner";
export type {
  TableCellProps,
  TableHeaderCellProps,
  TableProps,
  TableRowProps,
} from "./Table";
export {
  Table,
  TableBody,
  TableCell,
  TableFoot,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "./Table";
export { Tab, TabList, TabPanel, Tabs, type TabsProps } from "./Tabs";
export { Heading, type HeadingProps, MicroLabel, Text, type TextProps } from "./Text";
export {
  FilterBar,
  type FilterBarProps,
  FilterChip,
  type FilterChipProps,
  SearchField,
  type SearchFieldProps,
  Toolbar,
  type ToolbarProps,
} from "./Toolbar";
export {
  initializeTheme,
  setThemePreference,
  type ThemePreference,
  useTheme,
  useThemeStorageSync,
} from "./theme";
