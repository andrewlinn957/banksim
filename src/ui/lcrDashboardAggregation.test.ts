import { describe,it,expect } from 'vitest';
import { aggregateContributions } from '../components/LcrDashboard';
import type { LcrContribution } from '../domain/lcr';

describe('LCR dashboard contribution aggregation',()=>{
 it('groups repeated regulatory rows with the same factor while preserving totals',()=>{
  const rows:LcrContribution[]=[
   {template:'C74',corep:'C74 1.1',label:'Loan inflow',sourceLabel:'Cohort A',amount:2_000_000,factor:.5,weighted:1_000_000,capClass:'75'},
   {template:'C74',corep:'C74 1.1',label:'Loan inflow',sourceLabel:'Cohort B',amount:3_000_000,factor:.5,weighted:1_500_000,capClass:'75'},
   {template:'C74',corep:'C74 1.1',label:'Loan inflow',sourceLabel:'Cohort C',amount:1_000_000,factor:1,weighted:1_000_000,capClass:'75'},
  ];
  const grouped=aggregateContributions(rows);
  expect(grouped).toHaveLength(2);
  expect(grouped[0]).toMatchObject({amount:5_000_000,weighted:2_500_000,count:2,factor:.5});
  expect(grouped.reduce((sum,row)=>sum+row.weighted,0)).toBe(3_500_000);
 });
});
