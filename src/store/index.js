import { configureStore } from '@reduxjs/toolkit'

import entryReducer from './entrySlice'

export const store = configureStore({
  reducer: {
    entries: entryReducer,
  },
})
