import React, { useState } from "react";
import Tab, { TabProps } from "@mui/material/Tab";
import Tabs, { TabsProps } from "@mui/material/Tabs";

export type WrapperTabProps<T extends string | number = number> = Omit<TabProps, "value"> & { value: T };

export type TabsWrapperProps<T extends string | number = number> = {
  children: (idx: T) => React.ReactNode | React.ReactNode[];
  /**
   * An array of objects representing the MUI Tab component. Value is made a required property.
   */
  tabs: WrapperTabProps<T>[];
} & Omit<TabsProps, "children">;

/**
 * Wrapper component around the MUI Tabs component. Returns a function with one argument -
 * the value of the currently selected tab.
 * @param tabs - an array of objects representing the MUI Tab component. Value is made a required property.
 * @param ...muitabsprops - any other props to pass to the MUI Tabs component.
 */
function TabsWrapper<T extends string | number = number>({ children, tabs, ...tabsmuiprops }: TabsWrapperProps<T>) {
  // Sanity check
  if (tabs.length === 0) throw new Error("TabsWrapper: tabs array must contain at least one element");
  const [idx, setIdx] = useState(tabs[0].value);

  return (
    <>
      <Tabs {...tabsmuiprops} value={idx} onChange={(_, v) => setIdx(v)}>
        {tabs.map(({ ...tabprops }) => {
          return <Tab {...tabprops} />;
        })}
      </Tabs>
      {children(idx)}
    </>
  );
}

export default TabsWrapper;
